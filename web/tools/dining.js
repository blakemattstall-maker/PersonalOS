import { DateTime } from "luxon";
import supabase, { selectAll } from "../lib/supabase.js";
import { getUserTimezone } from "../lib/profile.js";
import { logActivity } from "./activityLog.js";


// The campus dining hall's menu, read from CBORD NetNutrition — the same
// system behind netnutrition.<school>.edu. There is no API and no feed: the
// site is an ASP.NET app from the XHR era that keeps WHERE YOU ARE in
// server-side session state. Selecting a dining hall, a station, a menu and a
// nutrition label are four sequential POSTs, and each one only works if the
// previous one happened in the same session — POSTing SelectMenu into a fresh
// session returns an error panel, verified directly. So this module is a tiny
// stateful crawler, not a REST client, and the order of calls inside
// syncDiningMenus is load-bearing.
//
// Two env vars keep the school out of the public repo (same reasoning as
// CANVAS_ICS_URL): NETNUTRITION_URL is the site's entry URL including the
// external-id path segment (".../NetNutrition/123" — the AJAX endpoints hang
// off that same segment, which cost an hour to discover: the bare
// /NetNutrition/Unit/... path answers 200 with an empty body), and
// NETNUTRITION_UNIT_OID is the dining hall to sync (its stations are child
// units and are discovered on every run, so new stations appear on their own).


const MEAL_ORDER = { Breakfast: 0, Brunch: 1, Lunch: 2, Dinner: 3 };

// How far back a day's menu is kept after it has passed. A week of history
// costs nothing and keeps "what did I eat Tuesday" answerable; unbounded
// growth is what the prune exists to prevent.
const KEEP_PAST_DAYS = 7;

// Menus for the next couple of days get re-fetched even when a row exists —
// dining halls edit close-in menus (a station runs out, a special gets added)
// and a stale "what's for dinner" is worse than no answer. Farther-out days
// only sync once; they'll pass through this window before anyone eats them.
const REFRESH_DAYS_AHEAD = 2;
const REFRESH_AFTER_HOURS = 6;

// Pause between requests to the school's server. This crawler walks hundreds
// of URLs on a full sync; it should look like a patient human, not a probe.
const REQUEST_GAP_MS = 120;


function config() {

  const url = process.env.NETNUTRITION_URL;
  const unitOid = Number(process.env.NETNUTRITION_UNIT_OID);

  if (!url || !unitOid) {
    throw new Error(
      "Dining is not configured (missing NETNUTRITION_URL or NETNUTRITION_UNIT_OID)."
    );
  }

  return { base: url.replace(/\/+$/, ""), unitOid };

}


function missingTable(error) {
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}

const SCHEMA_HINT =
  "The dining tables don't exist yet — run docs/schema-dining.sql in Supabase.";


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


// ---------------------------------------------------------------------------
// The HTTP layer: one session, cookies handled by hand.
// ---------------------------------------------------------------------------

// fetch(redirect:"follow") silently drops Set-Cookie headers from the
// intermediate responses, and NetNutrition's landing page is exactly that
// shape: the first GET 302s to itself while setting the session cookie, and
// the second GET only renders because the cookie came back. So redirects are
// followed manually, accumulating cookies as they arrive.
export async function openDiningSession() {

  const { base } = config();

  const cookies = new Map();

  let url = base;

  for (let hop = 0; hop < 4; hop++) {

    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Cookie: cookieHeader(cookies)
      }
    });

    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }

    if (res.status >= 300 && res.status < 400) {
      url = new URL(res.headers.get("location") || base, base).href;
      continue;
    }

    if (!res.ok) {
      throw new Error(`NetNutrition landing answered ${res.status}.`);
    }

    return { base, cookies };

  }

  throw new Error("NetNutrition landing redirected more than 4 times.");

}


function cookieHeader(cookies) {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}


// Every data endpoint is a form POST answering JSON of the shape
// { success, panels: [{ id, html }] } — except the nutrition label, which
// answers raw HTML (and an error PANEL on failure, still with HTTP 200, so
// status codes prove nothing here and the body has to be inspected).
async function nnPost(session, path, form) {

  await sleep(REQUEST_GAP_MS);

  const res = await fetch(`${session.base}/${path}`, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookieHeader(session.cookies)
    },
    body: new URLSearchParams(form).toString()
  });

  if (!res.ok) {
    throw new Error(`NetNutrition ${path} answered ${res.status}.`);
  }

  return res.text();

}


function panelFrom(body, path) {

  let parsed;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`NetNutrition ${path} did not answer JSON.`);
  }

  if (!parsed.success) {
    // The error panel is HTML boilerplate; the only useful fact is that the
    // session lost its place (expired, or the calls arrived out of order).
    throw new Error(`NetNutrition ${path} refused — session out of step.`);
  }

  return Object.fromEntries(
    (parsed.panels || []).map(panel => [panel.id, panel.html || ""])
  );

}


// ---------------------------------------------------------------------------
// Parsers. The markup is machine-generated and stable, which is what makes
// regex parsing defensible here — and tests/dining.test.js runs these against
// captured production HTML so a CBORD template change fails loudly, not
// quietly.
// ---------------------------------------------------------------------------

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}


// The dining hall's stations arrive as "child units" — cards in the
// childUnitsPanel, each carrying childUnitsSelectUnit(<oid>) and its name.
export function parseStations(childUnitsHtml) {

  const stations = [];

  const pattern = /childUnitsSelectUnit\((\d+)\);?"[^>]*>([^<]+)</g;

  for (const match of childUnitsHtml.matchAll(pattern)) {
    stations.push({ oid: Number(match[1]), name: decodeEntities(match[2]) });
  }

  return stations;

}


// A station's menu list groups meal links under date headers, in document
// order — so this walks headers and links in one pass, carrying the current
// date forward. Dates render like "Tuesday, August 18, 2026".
export function parseMenus(menuPanelHtml) {

  const menus = [];

  let date = null;

  const pattern =
    /<header class=['"]card-title h4['"]>([^<]+)<\/header>|menuListSelectMenu\((\d+)\)[^>]*>([^<]+)</g;

  for (const match of menuPanelHtml.matchAll(pattern)) {

    if (match[1]) {
      const parsed = DateTime.fromFormat(decodeEntities(match[1]), "cccc, LLLL d, yyyy");
      date = parsed.isValid ? parsed.toISODate() : null;
      continue;
    }

    if (date) {
      menus.push({
        date,
        meal: decodeEntities(match[3]),
        menuOid: Number(match[2])
      });
    }

  }

  return menus;

}


// The item table interleaves two kinds of row: course headers ("Entrees",
// "Sides") and item rows. Splitting on <tr and classifying each chunk keeps
// the course attached to the items under it without needing a real DOM.
export function parseItems(itemPanelHtml) {

  const items = [];

  let course = null;

  for (const row of itemPanelHtml.split(/<tr[\s>]/).slice(1)) {

    if (row.includes("cbo_nn_itemGroupRow")) {
      const name = row.match(/role=['"]button['"]>([^<]+)</);
      course = name ? decodeEntities(name[1]) : course;
      continue;
    }

    if (!/cbo_nn_item(?:Primary|Alternate)Row/.test(row)) continue;

    const oid = row.match(/showNutrition_(\d+)/);
    const name = row.match(/cbo_nn_itemHover['"]>([^<]+)</);

    if (!oid || !name) continue;

    // Trait icons ride inside the name cell as <img title='Fish' …>. They mix
    // allergens (Milk, Fish) with diet tags (Vegan, Halal) — the label's own
    // "Contains:" line is the authoritative allergen list, so these stay
    // "traits" and the UI decides which are diet badges.
    const traits = [...row.matchAll(/<img title=['"]([^'"]+)['"][^>]*images\/traits/g)]
      .map(m => decodeEntities(m[1]));

    // The only bare-text cell in the row is the serving size — the others
    // hold the checkbox, the name anchor and the portion <select>.
    const serving = row.match(/<td class=['"]align-middle['"]>([^<]+)<\/td>/);

    items.push({
      detailOid: Number(oid[1]),
      name: decodeEntities(name[1]),
      serving: serving ? decodeEntities(serving[1]) : null,
      course,
      traits
    });

  }

  return items;

}


// The label is a fixed-order US nutrition facts panel. Flattening the HTML to
// text and reading the fields by their printed names survives markup changes
// better than positional parsing — the names ARE the contract.
export function parseLabel(labelHtml) {

  const flat = decodeEntities(labelHtml.replace(/<[^>]+>/g, " "));

  const number = (raw) => {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/,/g, "");
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
  };

  // "Total Fat 15.22g 20%" / "Trans Fat NA %" — amount and daily-value are
  // both optional in the wild, and NA means the school left it blank.
  const nutrient = (label) => {
    const match = flat.match(
      new RegExp(`${label}\\s+(NA|[\\d.,]+)\\s*(?:g|mg|mcg)?\\s*(NA|[\\d.,]+)?\\s*%?`)
    );
    if (!match) return { amount: null, dv: null };
    return { amount: number(match[1]), dv: number(match[2]) };
  };

  const percent = (label) => {
    const match = flat.match(new RegExp(`${label}\\s+(NA|[\\d.,]+)\\s*%`));
    return match ? number(match[1]) : null;
  };

  const serving = flat.match(/Serving Size:\s*(.*?)\s*Amount Per Serving/);
  const calories = flat.match(/Calories\s+([\d,]+)/);
  const caloriesFromFat = flat.match(/Calories from Fat\s+([\d,]+)/);
  const ingredients = flat.match(/Ingredients:\s*(.*?)\s*(?:Contains:|$)/);
  const contains = flat.match(/Contains:\s*(.+)$/);

  const fat = nutrient("Total Fat");
  const satFat = nutrient("Saturated Fat");
  const transFat = nutrient("Trans Fat");
  const cholesterol = nutrient("Cholesterol");
  const sodium = nutrient("Sodium");
  const carbs = nutrient("Total Carbohydrate");
  const fiber = nutrient("Dietary Fiber");
  const sugars = nutrient("Sugars");
  const protein = nutrient("Protein");

  return {
    name: decodeEntities((labelHtml.match(/cbo_nn_LabelHeader['"][^>]*>([^<]+)</) || [])[1] || ""),
    serving: serving ? serving[1] : null,
    nutrition: {
      calories: number(calories?.[1]),
      calories_from_fat: number(caloriesFromFat?.[1]),
      fat_g: fat.amount, fat_dv: fat.dv,
      sat_fat_g: satFat.amount, sat_fat_dv: satFat.dv,
      trans_fat_g: transFat.amount,
      cholesterol_mg: cholesterol.amount, cholesterol_dv: cholesterol.dv,
      sodium_mg: sodium.amount, sodium_dv: sodium.dv,
      carbs_g: carbs.amount, carbs_dv: carbs.dv,
      fiber_g: fiber.amount, fiber_dv: fiber.dv,
      sugars_g: sugars.amount,
      protein_g: protein.amount, protein_dv: protein.dv,
      vitamin_a_dv: percent("Vitamin A"),
      vitamin_c_dv: percent("Vitamin C"),
      calcium_dv: percent("Calcium"),
      iron_dv: percent("Iron")
    },
    ingredients: ingredients ? ingredients[1] : null,
    allergens: contains
      ? contains[1].split(",").map(part => part.trim()).filter(Boolean)
      : []
  };

}


// The nutrition-label cache key. A recipe's label is identical every day it
// appears — "Steamed Rice" shows up dozens of times a fortnight — so labels
// are fetched once per (name, serving) ever, not once per menu appearance.
// That cache is the difference between a sync that fits Vercel's window and
// one that re-downloads a thousand labels a night.
export function recipeKey(name, serving) {
  return `${String(name).toLowerCase().trim()}|${String(serving || "").toLowerCase().trim()}`
    .replace(/\s+/g, " ");
}


// ---------------------------------------------------------------------------
// The crawl steps, in the order the server's session state demands.
// ---------------------------------------------------------------------------

export async function selectDiningHall(session) {

  const { unitOid } = config();

  const panels = panelFrom(
    await nnPost(session, "Unit/SelectUnitFromUnitsList", { unitOid }),
    "SelectUnitFromUnitsList"
  );

  return parseStations(panels.childUnitsPanel || "");

}


export async function selectStation(session, stationOid) {

  const panels = panelFrom(
    await nnPost(session, "Unit/SelectUnitFromChildUnitsList", { unitOid: stationOid }),
    "SelectUnitFromChildUnitsList"
  );

  return parseMenus(panels.menuPanel || "");

}


export async function selectMenu(session, menuOid) {

  const panels = panelFrom(
    await nnPost(session, "Menu/SelectMenu", { menuOid }),
    "SelectMenu"
  );

  return parseItems(panels.itemPanel || "");

}


export async function fetchLabel(session, detailOid) {

  const body = await nnPost(session, "NutritionDetail/ShowItemNutritionLabel", { detailOid });

  if (!body.includes("Nutrition Information")) {
    throw new Error(`Nutrition label ${detailOid} came back as an error panel.`);
  }

  return parseLabel(body);

}


// ---------------------------------------------------------------------------
// The sync.
// ---------------------------------------------------------------------------

// Incremental by construction rather than by cursor: every run re-reads the
// cheap layers (one unit select + one select per station, ~a dozen requests),
// diffs what the site lists against what the tables hold, and spends whatever
// remains of its time budget on the expensive layer — menus and labels —
// nearest dates first. A run that hits the budget just stops; the next run's
// diff picks up exactly where it left off, with nothing to persist about
// where that was. The first-ever sync is simply this same operation run with
// a large budget (or tapped repeatedly from the dashboard) until `remaining`
// reaches zero.
export async function syncDiningMenus({ budgetMs = 40_000 } = {}) {

  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;

  const tz = await getUserTimezone();
  const today = DateTime.now().setZone(tz).toISODate();
  const refreshEdge = DateTime.now().setZone(tz).plus({ days: REFRESH_DAYS_AHEAD }).toISODate();
  const staleEdge = DateTime.now().minus({ hours: REFRESH_AFTER_HOURS }).toISO();

  const result = {
    success: false, stations: 0, listed: 0, synced: 0, labels: 0,
    remaining: 0, pruned: 0, errors: []
  };

  try {

    // What the tables already hold, keyed the way the site lists menus.
    const existing = await selectAll(
      "dining_menus",
      "station_oid, date, meal, menu_oid, fetched_at",
      { modify: q => q.order("id", { ascending: true }) }
    );

    if (existing.error) {
      throw new Error(missingTable(existing.error) ? SCHEMA_HINT : existing.error.message);
    }

    const have = new Map(existing.rows.map(row =>
      [`${row.station_oid}|${row.date}|${row.meal}`, row]
    ));

    const known = await selectAll("dining_recipes", "key", {
      modify: q => q.order("key", { ascending: true })
    });

    if (known.error) {
      throw new Error(missingTable(known.error) ? SCHEMA_HINT : known.error.message);
    }

    const recipes = new Set(known.rows.map(row => row.key));


    let session = await openDiningSession();

    const stations = await selectDiningHall(session);

    result.stations = stations.length;

    if (stations.length === 0) {
      throw new Error("NetNutrition listed no stations — the unit oid may be wrong.");
    }


    // Walk every station's menu list first (cheap), building the worklist.
    const work = [];

    for (const station of stations) {

      const menus = await selectStation(session, station.oid);

      for (const menu of menus) {

        if (menu.date < today) continue;

        result.listed += 1;

        const row = have.get(`${station.oid}|${menu.date}|${menu.meal}`);

        const needs =
          !row ||
          Number(row.menu_oid) !== menu.menuOid ||
          (menu.date <= refreshEdge && row.fetched_at < staleEdge);

        if (needs) work.push({ station, ...menu });

      }

    }

    // Nearest meals first, so when the budget runs out it ran out on day 12,
    // not on tomorrow's lunch.
    work.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 :
      (MEAL_ORDER[a.meal] ?? 9) - (MEAL_ORDER[b.meal] ?? 9)
    );

    result.remaining = work.length;


    // The expensive layer. Grouped by station because SelectMenu only works
    // with its station selected; re-selecting on station change keeps the
    // session's cursor where the server expects it.
    let selectedStation = null;

    for (const job of work) {

      if (Date.now() >= deadline) break;

      try {

        if (selectedStation !== job.station.oid) {
          await selectStation(session, job.station.oid);
          selectedStation = job.station.oid;
        }

        const items = await selectMenu(session, job.menuOid);

        // Labels for recipes this table has never seen. A menu is only
        // written once every one of its labels is stored — a budget that
        // expires mid-menu leaves no row, so the next run redoes the whole
        // menu rather than believing a half-labelled one.
        for (const item of items) {

          const key = recipeKey(item.name, item.serving);

          if (recipes.has(key)) continue;

          const label = await fetchLabel(session, item.detailOid);

          const { error } = await supabase.from("dining_recipes").upsert([{
            key,
            name: item.name,
            serving: item.serving,
            nutrition: label.nutrition,
            ingredients: label.ingredients,
            // The label's "Contains:" line — the authoritative allergen list.
            // Diet tags and icon-only allergens live on the menu item as
            // traits; this field is only ever what the label itself declared.
            allergens: label.allergens,
            detail_oid: item.detailOid,
            updated_at: new Date().toISOString()
          }], { onConflict: "key" });

          if (error) throw new Error(missingTable(error) ? SCHEMA_HINT : error.message);

          recipes.add(key);
          result.labels += 1;

        }

        const { error } = await supabase.from("dining_menus").upsert([{
          station: job.station.name,
          station_oid: job.station.oid,
          date: job.date,
          meal: job.meal,
          menu_oid: job.menuOid,
          items: items.map(item => ({
            name: item.name,
            serving: item.serving,
            course: item.course,
            traits: item.traits,
            recipe: recipeKey(item.name, item.serving)
          })),
          fetched_at: new Date().toISOString()
        }], { onConflict: "station_oid,date,meal" });

        if (error) throw new Error(missingTable(error) ? SCHEMA_HINT : error.message);

        result.synced += 1;
        result.remaining -= 1;

      } catch (error) {

        if (error.message === SCHEMA_HINT) throw error;

        // One bad menu (or an expired session) must not cost the rest of the
        // run: reopen, re-anchor on the dining hall, and let the loop
        // re-select the station on the next job.
        result.errors.push(`${job.station.name} ${job.date} ${job.meal}: ${error.message}`);

        session = await openDiningSession();
        await selectDiningHall(session);
        selectedStation = null;

      }

    }


    // Yesterday's menus age out a week later. Errors here are logged, not
    // fatal — pruning is housekeeping.
    const pruneEdge = DateTime.now().setZone(tz).minus({ days: KEEP_PAST_DAYS }).toISODate();

    const pruned = await supabase
      .from("dining_menus")
      .delete()
      .lt("date", pruneEdge)
      .select("id");

    if (!pruned.error) result.pruned = (pruned.data || []).length;

    result.success = result.errors.length === 0;

  } catch (error) {

    result.errors.push(error.message);
    result.success = false;

  }


  await logActivity({
    action: "dining_sync",
    input: { budgetMs },
    output: result,
    success: result.success,
    source: "cron",
    duration_ms: Date.now() - startedAt,
    error_message: result.errors[0] || null
  }).catch(error => console.error("DINING SYNC LOG FAILED:", error.message));

  return result;

}


// ---------------------------------------------------------------------------
// The read side — what the dashboard page asks for.
// ---------------------------------------------------------------------------

// One day's menus across every station, nutrition attached, plus the list of
// days that exist so the page can offer them. Defaults to today in the user's
// timezone: "what's for dinner" is the whole reason this table exists.
export async function getDiningDay({ date = null } = {}) {

  const tz = await getUserTimezone();
  const today = DateTime.now().setZone(tz).toISODate();

  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : today;

  const index = await selectAll("dining_menus", "date, fetched_at", {
    modify: q => q.gte("date", today).order("date", { ascending: true })
  });

  if (index.error) {
    if (missingTable(index.error)) {
      return { success: false, configured: false, error: SCHEMA_HINT, dates: [], meals: [] };
    }
    throw new Error(index.error.message);
  }

  const dates = [...new Set(index.rows.map(row => row.date))];

  const lastSynced = index.rows.reduce(
    (latest, row) => (row.fetched_at > latest ? row.fetched_at : latest),
    ""
  ) || null;

  const { data: rows, error } = await supabase
    .from("dining_menus")
    .select("station, station_oid, meal, items, fetched_at")
    .eq("date", wanted)
    .order("station_oid", { ascending: true });

  if (error) throw new Error(error.message);


  // Pull the labels for every recipe on the day's menus, in chunks — a full
  // day across all stations can reference several hundred keys and PostgREST
  // URLs have limits.
  const keys = [...new Set(
    (rows || []).flatMap(row => (row.items || []).map(item => item.recipe))
  )].filter(Boolean);

  const labels = new Map();

  for (let at = 0; at < keys.length; at += 150) {

    const { data: chunk, error: chunkError } = await supabase
      .from("dining_recipes")
      .select("key, nutrition, ingredients, allergens")
      .in("key", keys.slice(at, at + 150));

    if (chunkError) throw new Error(chunkError.message);

    for (const recipe of chunk || []) labels.set(recipe.key, recipe);

  }


  // Group station rows under their meal, meals in serving order. Stations
  // that serve all day publish under made-up meal names ("Daily Selections"
  // for the salad bar and beverages, "Bakery Selections") — those are not
  // meals anyone chooses between, so instead of becoming tabs of their own
  // they ride along under every real meal, flagged all-day and listed after
  // the cooking stations.
  const byMeal = new Map();
  const allDay = [];

  const shape = (row) => ({
    station: row.station,
    allDay: !(row.meal in MEAL_ORDER),
    items: (row.items || []).map(item => {
      const label = labels.get(item.recipe);
      return {
        name: item.name,
        serving: item.serving,
        course: item.course,
        traits: item.traits || [],
        allergens: label?.allergens || [],
        nutrition: label?.nutrition || null,
        ingredients: label?.ingredients || null
      };
    })
  });

  for (const row of rows || []) {

    if (!(row.meal in MEAL_ORDER)) {
      allDay.push(shape(row));
      continue;
    }

    if (!byMeal.has(row.meal)) byMeal.set(row.meal, []);

    byMeal.get(row.meal).push(shape(row));

  }

  const meals = [...byMeal.entries()]
    .sort((a, b) => (MEAL_ORDER[a[0]] ?? 9) - (MEAL_ORDER[b[0]] ?? 9))
    .map(([meal, stations]) => ({ meal, stations: [...stations, ...allDay] }));

  // A day with only all-day stations (a break week, say) still deserves a page.
  if (meals.length === 0 && allDay.length > 0) {
    meals.push({ meal: "All day", stations: allDay });
  }


  // Which meal the page should open on. Computed here, in the user's
  // timezone, rather than on the client — the client's first render happens
  // on the server too, and a Date.now() default would hydrate differently
  // than it rendered. Today opens on the meal you're heading into (breakfast
  // until 10:30, lunch until 15:30); any other day opens on its first meal,
  // because a future day is being planned, not eaten.
  let suggestedMeal = meals[0]?.meal || null;

  if (wanted === today && meals.length > 0) {

    const now = DateTime.now().setZone(tz);
    const clock = now.hour + now.minute / 60;

    const wantedMeal = clock < 10.5 ? "Breakfast" : clock < 15.5 ? "Lunch" : "Dinner";

    if (meals.some(m => m.meal === wantedMeal)) suggestedMeal = wantedMeal;

  }


  return {
    success: true,
    configured: true,
    date: wanted,
    today,
    dates,
    meals,
    suggestedMeal,
    lastSynced
  };

}
