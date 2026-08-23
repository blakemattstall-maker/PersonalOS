import { DateTime } from "luxon";
import supabase from "../lib/supabase.js";
import openai from "../lib/openai.js";
import { MODELS } from "../lib/models.js";
import { getSettings, saveSettings, DEFAULTS } from "../lib/settings.js";
import { getUserTimezone } from "../lib/profile.js";
import { getDiningDay } from "./dining.js";
import { getEvents, createEvent, deleteEventByGoogleId } from "./googleCalendar.js";


// Meal planning and tracking on top of the dining-hall menus.
//
// The split of labour is the same one the rest of this codebase uses: the
// model does the one thing only a model can do — read a whole day's menu
// against the user's preferences and form an opinion about what to eat — and
// code does everything that must be *correct*: matching picks back to real
// menu items, summing macros, finding a free calendar slot inside the meal
// window, writing the log. A plan the model hallucinates an item into simply
// loses that item at validation, visibly.
//
// Meal windows are preferences, not scraped facts, because the dining site's
// hours endpoint returns "Closed" for every day of the week — nobody at the
// school ever filled it in. The person who eats there is the better source;
// "dinner window is 5 to 7" through capture updates them.


const MISSING_LOG_HINT =
  "Meal tracking isn't set up yet — run docs/schema-dining-log.sql in Supabase.";

function missingTable(error) {
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}


// ---------------------------------------------------------------------------
// Preferences.
// ---------------------------------------------------------------------------

// Stored settings shallow-replace defaults key-by-key, so a saved
// { dislikes: [...] } would otherwise silently erase the meal windows. This
// is the one reader, and it re-fills anything the stored object is missing.
export async function getDiningPrefs() {

  const { dining } = await getSettings();

  const stored = dining && typeof dining === "object" ? dining : {};

  const base = DEFAULTS.dining;

  return {
    ...base,
    ...stored,
    dislikes: Array.isArray(stored.dislikes) ? stored.dislikes : base.dislikes,
    likes: Array.isArray(stored.likes) ? stored.likes : base.likes,
    meal_windows: {
      ...base.meal_windows,
      ...(stored.meal_windows || {})
    }
  };

}


export async function updateDiningPrefs({
  dislike = null,
  like = null,
  remove = null,
  calorie_target = null,
  protein_target = null,
  meal = null,
  window_start = null,
  window_end = null,
  meal_minutes = null
} = {}) {

  const prefs = await getDiningPrefs();

  const changes = [];

  const norm = (s) => String(s).trim();
  const has = (list, s) => list.some(x => x.toLowerCase() === norm(s).toLowerCase());

  if (dislike && !has(prefs.dislikes, dislike)) {
    prefs.dislikes.push(norm(dislike));
    changes.push(`won't suggest ${norm(dislike)}`);
  }

  if (like && !has(prefs.likes, like)) {
    prefs.likes.push(norm(like));
    changes.push(`noted you like ${norm(like)}`);
  }

  if (remove) {
    const target = norm(remove).toLowerCase();
    const before = prefs.dislikes.length + prefs.likes.length;
    prefs.dislikes = prefs.dislikes.filter(x => x.toLowerCase() !== target);
    prefs.likes = prefs.likes.filter(x => x.toLowerCase() !== target);
    if (prefs.dislikes.length + prefs.likes.length < before) {
      changes.push(`cleared ${norm(remove)}`);
    }
  }

  if (Number.isFinite(Number(calorie_target)) && calorie_target !== null) {
    prefs.calorie_target = Math.round(Number(calorie_target));
    changes.push(`calorie target ${prefs.calorie_target}`);
  }

  if (Number.isFinite(Number(protein_target)) && protein_target !== null) {
    prefs.protein_target = Math.round(Number(protein_target));
    changes.push(`protein target ${prefs.protein_target}g`);
  }

  if (Number.isFinite(Number(meal_minutes)) && meal_minutes !== null) {
    prefs.meal_minutes = Math.min(120, Math.max(15, Math.round(Number(meal_minutes))));
    changes.push(`meals blocked as ${prefs.meal_minutes} minutes`);
  }

  if (meal && (window_start || window_end)) {

    const key = Object.keys(prefs.meal_windows)
      .find(k => k.toLowerCase() === String(meal).toLowerCase());

    if (key) {
      const window = { ...prefs.meal_windows[key] };
      if (window_start) window.start = window_start;
      if (window_end) window.end = window_end;
      // Keep the anchor inside the window it anchors.
      if (window.anchor < window.start || window.anchor > window.end) {
        window.anchor = window.start;
      }
      prefs.meal_windows[key] = window;
      changes.push(`${key} window ${window.start}–${window.end}`);
    }

  }

  if (changes.length === 0) {
    return { success: true, message: "Nothing new there — those preferences were already set." };
  }

  const saved = await saveSettings({ dining: prefs });

  if (!saved.success) {
    return { success: false, message: saved.error || "Couldn't save that preference." };
  }

  return {
    success: true,
    message: `Got it — ${changes.join(", ")}.`,
    data: { prefs }
  };

}


// ---------------------------------------------------------------------------
// The log.
// ---------------------------------------------------------------------------

function sumField(items, field) {

  const values = items
    .map(item => item[field] == null ? null : Number(item[field]) * (Number(item.quantity) || 1))
    .filter(v => v != null && Number.isFinite(v));

  // All-null means "unknown", not zero — an unmatched item must not read as
  // a zero-calorie meal.
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10 : null;

}


export async function getDiningLog({ date = null } = {}) {

  const tz = await getUserTimezone();

  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "")
    ? date
    : DateTime.now().setZone(tz).toISODate();

  const { data, error } = await supabase
    .from("dining_log")
    .select("*")
    .eq("date", day)
    .order("created_at", { ascending: true });

  if (error) {
    if (missingTable(error)) {
      return { success: false, configured: false, error: MISSING_LOG_HINT, date: day, eaten: [], planned: [], totals: {} };
    }
    throw new Error(error.message);
  }

  const rows = data || [];

  const eaten = rows.filter(r => r.status === "eaten");
  const planned = rows.filter(r => r.status === "planned");

  const total = (field) => {
    const values = eaten.map(r => r[field]).filter(v => v != null);
    return values.length ? Math.round(values.reduce((a, b) => a + Number(b), 0)) : null;
  };

  const prefs = await getDiningPrefs();

  return {
    success: true,
    configured: true,
    date: day,
    eaten,
    planned,
    totals: {
      calories: total("calories"),
      protein_g: total("protein_g"),
      carbs_g: total("carbs_g"),
      fat_g: total("fat_g")
    },
    targets: {
      calories: prefs.calorie_target,
      protein_g: prefs.protein_target
    }
  };

}


// The non-model path: exact items, straight to the log. The Track buttons on
// /food and the planner both come through here.
export async function logMealItems({ items, meal, date = null, status = "eaten", station = null, source = "app", event_id = null, note = null }) {

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Nothing to log.");
  }

  const tz = await getUserTimezone();

  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "")
    ? date
    : DateTime.now().setZone(tz).toISODate();

  // One row per FOOD, not per meal.
  //
  // Logging "eggs, bacon and a bagel" as a single row made the whole meal one
  // undoable blob: the matcher gets an item wrong now and then, and fixing one
  // line meant deleting all three and re-saying the rest. A row per item is
  // individually editable and removable, and the day's totals are a sum either
  // way. Planned rows stay whole — a plan owns one calendar event, and
  // splitting it would give every item a claim on the same block.
  const perItem = status !== "planned";

  const rows = perItem
    ? items.map(item => ({
        date: day,
        meal: meal || "Snack",
        status,
        station: item.station || station,
        items: [item],
        calories: sumField([item], "calories"),
        protein_g: sumField([item], "protein_g"),
        carbs_g: sumField([item], "carbs_g"),
        fat_g: sumField([item], "fat_g"),
        source,
        event_id,
        note
      }))
    : [{
        date: day,
        meal: meal || "Snack",
        status,
        station,
        items,
        calories: sumField(items, "calories"),
        protein_g: sumField(items, "protein_g"),
        carbs_g: sumField(items, "carbs_g"),
        fat_g: sumField(items, "fat_g"),
        source,
        event_id,
        note
      }];

  const { data, error } = await supabase
    .from("dining_log")
    .insert(rows)
    .select();

  if (error) {
    if (missingTable(error)) return { success: false, message: MISSING_LOG_HINT };
    throw new Error(error.message);
  }

  // `row` stays the first inserted row so existing callers (which read
  // row.event_id and row.id) behave exactly as before.
  return { success: true, row: (data || [])[0], rows: data || [] };

}


export async function removeLogEntry({ id }) {

  const { data, error } = await supabase
    .from("dining_log")
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);

  // A planned row owns its calendar event; removing the plan removes the
  // block. Best-effort — the row is already gone either way.
  if (data?.event_id) {
    await deleteEventByGoogleId(data.event_id).catch(error =>
      console.error("PLAN EVENT DELETE FAILED:", error.message)
    );
  }

  return { success: true, removed: Boolean(data) };

}


// ---------------------------------------------------------------------------
// Shared plumbing for the model-facing tools.
// ---------------------------------------------------------------------------

// One line per item, one block per meal. `310c 34p 6cb 16f` keeps a full day
// under ~15KB; the legend travels in the prompt so the abbreviation is the
// model's problem exactly once.
function menuBrief(dayData, { meals = null } = {}) {

  const wanted = meals ? new Set(meals) : null;

  const lines = [];

  for (const mealBlock of dayData.meals) {

    if (wanted && !wanted.has(mealBlock.meal)) continue;

    lines.push(`== ${mealBlock.meal} ==`);

    for (const station of mealBlock.stations) {

      const items = station.items.map(item => {
        const n = item.nutrition || {};
        const macro = n.calories != null
          ? ` ${Math.round(n.calories)}c ${n.protein_g != null ? Math.round(n.protein_g) : "?"}p ${n.carbs_g != null ? Math.round(n.carbs_g) : "?"}cb ${n.fat_g != null ? Math.round(n.fat_g) : "?"}f`
          : "";
        const traits = item.traits?.length ? ` [${item.traits.join(",")}]` : "";
        const contains = item.allergens?.length ? ` {Contains: ${item.allergens.join(",")}}` : "";
        return `${item.name} (${item.serving || "serving"})${macro}${traits}${contains}`;
      });

      lines.push(`${station.station}${station.allDay ? " (all day)" : ""}: ${items.join("; ")}`);

    }

  }

  return lines.join("\n");

}


// Every menu item on the day, indexed for validating model picks back to
// reality. Keyed by meal so "Beef Tips" at dinner never matches breakfast.
function itemIndex(dayData) {

  const index = new Map();

  for (const mealBlock of dayData.meals) {

    const forMeal = [];

    for (const station of mealBlock.stations) {
      for (const item of station.items) {
        forMeal.push({ ...item, station: station.station });
      }
    }

    index.set(mealBlock.meal, forMeal);

  }

  return index;

}


function findMenuItem(index, meal, name) {

  const items = index.get(meal) || [];

  const wanted = String(name || "").toLowerCase().trim();

  return items.find(i => i.name.toLowerCase() === wanted)
    || items.find(i => i.name.toLowerCase().includes(wanted) || wanted.includes(i.name.toLowerCase()))
    || null;

}


function asLogItem(menuItem, quantity = 1) {

  const n = menuItem.nutrition || {};

  return {
    name: menuItem.name,
    serving: menuItem.serving,
    station: menuItem.station,
    quantity,
    calories: n.calories ?? null,
    protein_g: n.protein_g ?? null,
    carbs_g: n.carbs_g ?? null,
    fat_g: n.fat_g ?? null
  };

}


function fmtTotals(totals) {

  const parts = [];

  if (totals.calories != null) parts.push(`${Math.round(totals.calories)} cal`);
  if (totals.protein_g != null) parts.push(`${Math.round(totals.protein_g)}g protein`);

  return parts.join(", ") || "nutrition unknown";

}


// ---------------------------------------------------------------------------
// Ask the menu.
// ---------------------------------------------------------------------------

export async function answerDiningQuestion({ question, date = null }) {

  if (!question) throw new Error("No question provided.");

  const tz = await getUserTimezone();
  const now = DateTime.now().setZone(tz);

  const dayData = await getDiningDay({ date });

  if (!dayData.success) {
    return { success: false, message: dayData.error || "The menu isn't available right now." };
  }

  if (dayData.meals.length === 0) {
    return {
      success: true,
      message: `No menu is published for ${dayData.date} — the dining hall posts about two weeks out.`
    };
  }

  const [prefs, log] = await Promise.all([
    getDiningPrefs(),
    getDiningLog({ date: dayData.date }).catch(() => null)
  ]);

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [
      {
        role: "system",
        content: `You are Almanac, answering a question about the campus dining hall menu.

It is ${now.toFormat("cccc, yyyy-MM-dd HH:mm")} (${tz}). The menu below is for ${dayData.date}.
Macro shorthand: 310c 34p 6cb 16f = calories, protein g, carbs g, fat g.

The user's food preferences:
- Never recommend anything containing: ${prefs.dislikes.join(", ") || "(nothing ruled out)"}
- They like: ${prefs.likes.join(", ") || "(none noted)"}
- Daily targets: ${prefs.calorie_target || "no"} calories, ${prefs.protein_target || "no"} g protein.
${log?.success && log.totals.calories != null ? `- Already eaten today: ${fmtTotals(log.totals)}.` : ""}

MENU:
${menuBrief(dayData)}

ANSWER STYLE: spoken aloud or read on a phone. Short, concrete, blunt —
name actual stations and items with their numbers. Plain text, no markdown,
two or three sentences unless genuinely more is needed. Only ever cite items
from the menu above; if nothing fits, say so and name the least-bad option.`
      },
      { role: "user", content: question }
    ]

  });

  const answer = response.choices[0].message.content;

  return { success: true, message: answer, data: { question, date: dayData.date, answer } };

}


// ---------------------------------------------------------------------------
// Track what was eaten, from words.
// ---------------------------------------------------------------------------

function inferMeal(now, windows) {

  // The meal whose window we're inside; otherwise the most recent one begun.
  // At 16:10 "I had a burger" means lunch, not dinner.
  const minutes = now.hour * 60 + now.minute;

  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return h * 60 + (m || 0);
  };

  const ordered = Object.entries(windows)
    .sort((a, b) => toMin(a[1].start) - toMin(b[1].start));

  let current = null;

  for (const [meal, w] of ordered) {
    if (minutes >= toMin(w.start)) current = meal;
    if (minutes >= toMin(w.start) && minutes <= toMin(w.end)) return meal;
  }

  return current || ordered[0]?.[0] || "Snack";

}


export async function logMeal({ description, meal = null, date = null }) {

  if (!description) throw new Error("Nothing to log.");

  const tz = await getUserTimezone();
  const now = DateTime.now().setZone(tz);

  const prefs = await getDiningPrefs();

  const dayData = await getDiningDay({ date });

  const day = dayData.date || now.toISODate();

  const targetMeal = meal || inferMeal(now, prefs.meal_windows);

  const index = itemIndex(dayData);

  // Matching is extraction, not judgment: here's the catalogue, here's what
  // they said, line them up. All-day stations ride under every meal, so the
  // target meal's list already includes the salad bar and drinks.
  const catalogue = (index.get(targetMeal) || [])
    .concat(targetMeal === "All day" ? [] : (index.get("All day") || []));

  let matches = [];
  let unmatched = [];

  if (catalogue.length > 0) {

    const response = await openai.chat.completions.create({

      model: MODELS.EXTRACT,

      response_format: { type: "json_object" },

      messages: [
        {
          role: "system",
          content: `Match what the user says they ate to the dining hall's menu items.

MENU ITEMS for ${targetMeal} on ${day} (exact names):
${catalogue.map(i => `- ${i.name} (${i.serving || "serving"}, ${i.station})`).join("\n")}

Return JSON: {"items":[{"menu_name": "<exact name from the list, or null if nothing plausibly matches>", "said": "<their words for it>", "quantity": <number, default 1>}]}

Match generously on wording ("the beef" -> a beef entree if only one exists)
but never guess between two equally plausible items — return null for those.
Quantities: "two slices" is 2. Ignore words that aren't food.`
        },
        { role: "user", content: description }
      ]

    });

    let parsed = { items: [] };

    try {
      parsed = JSON.parse(response.choices[0].message.content);
    } catch {
      parsed = { items: [] };
    }

    for (const pick of parsed.items || []) {

      const found = pick.menu_name ? findMenuItem(index, targetMeal, pick.menu_name)
        || findMenuItem(index, "All day", pick.menu_name) : null;

      if (found) {
        matches.push(asLogItem(found, Number(pick.quantity) || 1));
      } else if (pick.said) {
        unmatched.push({ name: pick.said, serving: null, station: null, quantity: Number(pick.quantity) || 1, calories: null, protein_g: null, carbs_g: null, fat_g: null });
      }

    }

  } else {

    // No menu that day — log the words with unknown macros rather than
    // refusing or inventing numbers.
    unmatched.push({ name: description.trim(), serving: null, station: null, quantity: 1, calories: null, protein_g: null, carbs_g: null, fat_g: null });

  }

  if (matches.length === 0 && unmatched.length === 0) {
    return { success: false, message: "Couldn't find any food in that — nothing was logged." };
  }

  const logged = await logMealItems({
    items: [...matches, ...unmatched],
    meal: targetMeal,
    date: day,
    source: "capture"
  });

  if (!logged.success) return logged;

  const log = await getDiningLog({ date: day });

  const names = [...matches, ...unmatched].map(i => i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name);

  const caveat = unmatched.length
    ? ` (${unmatched.map(u => u.name).join(", ")} wasn't on the menu, so its nutrition is unrecorded)`
    : "";

  // Each food is now its own row, so the meal's totals are the sum of what
  // was just written, not one row's figures.
  const justLogged = {
    calories: sumField(logged.rows || [logged.row], "calories"),
    protein_g: sumField(logged.rows || [logged.row], "protein_g")
  };

  return {
    success: true,
    message: `Logged ${targetMeal.toLowerCase()}: ${names.join(", ")} — ${fmtTotals(justLogged)}${caveat}. Today so far: ${fmtTotals(log.totals)}.`,
    data: { rows: logged.rows, totals: log.totals }
  };

}


// ---------------------------------------------------------------------------
// The planner.
// ---------------------------------------------------------------------------

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}


// First free `minutes`-long start inside the window, trying the model's
// suggestion first, then quarter-hour steps after it, then before it. Busy
// intervals come from the real calendar.
export function findFreeSlot({ busy, day, window, preferred, minutes, tz }) {

  const dayStart = DateTime.fromISO(day, { zone: tz });

  const candidateAt = (minsIntoDay) => dayStart.plus({ minutes: minsIntoDay });

  const windowStart = toMinutes(window.start);
  const windowEnd = toMinutes(window.end);

  const wanted = preferred ? toMinutes(preferred) : toMinutes(window.anchor || window.start);

  const anchor = Math.min(Math.max(wanted, windowStart), Math.max(windowStart, windowEnd - minutes));

  const overlaps = (start) => {
    const end = start.plus({ minutes });
    return busy.some(b => start < b.end && end > b.start);
  };

  const candidates = [];

  for (let at = anchor; at + minutes <= windowEnd; at += 15) candidates.push(at);
  for (let at = anchor - 15; at >= windowStart; at -= 15) candidates.push(at);

  for (const at of candidates) {
    const start = candidateAt(at);
    if (!overlaps(start)) return start;
  }

  return null;

}


export async function planMeals({ date = null, meals = null, note = null }) {

  const tz = await getUserTimezone();
  const now = DateTime.now().setZone(tz);
  const today = now.toISODate();

  const dayData = await getDiningDay({ date });

  if (!dayData.success) {
    return { success: false, message: dayData.error || "The menu isn't available." };
  }

  const day = dayData.date;

  if (day < today) {
    return { success: false, message: "That day has already happened — plans go forward." };
  }

  if (dayData.meals.length === 0) {
    return {
      success: true,
      message: `No menu is published for ${day} yet — the dining hall posts about two weeks out.`
    };
  }

  const prefs = await getDiningPrefs();

  const log = await getDiningLog({ date: day });

  if (!log.success) {
    // Planning writes log rows, so the log table is a hard requirement.
    return { success: false, message: log.error };
  }


  // Which meals to plan: what was asked for, else what's still ahead. A plan
  // made at 2pm plans lunch only if lunch's window hasn't closed.
  const plannable = dayData.meals
    .map(m => m.meal)
    .filter(m => prefs.meal_windows[m]);

  let targets = Array.isArray(meals) && meals.length
    ? plannable.filter(m => meals.some(x => String(x).toLowerCase() === m.toLowerCase()))
    : plannable;

  if (day === today) {
    targets = targets.filter(m => {
      const end = toMinutes(prefs.meal_windows[m].end);
      return now.hour * 60 + now.minute < end;
    });
  }

  if (targets.length === 0) {
    return { success: true, message: `Nothing left to plan for ${day} — every meal window has passed.` };
  }


  // The day's real calendar, for slotting around.
  const eventsResult = await getEvents({ startDate: day, endDate: day, timezone: tz, maxResults: 100 })
    .catch(error => {
      console.error("MEAL PLAN calendar read FAILED:", error.message);
      return { events: [], failed: true };
    });

  const busy = (eventsResult.events || [])
    .filter(e => e.start && e.end && !e.allDay)
    .map(e => ({
      start: DateTime.fromISO(e.start).setZone(tz),
      end: DateTime.fromISO(e.end).setZone(tz),
      title: e.title || e.summary || "busy"
    }));

  const busyText = busy.length
    ? busy.map(b => `${b.start.toFormat("HH:mm")}–${b.end.toFormat("HH:mm")} ${b.title}`).join("; ")
    : "(nothing scheduled)";


  const alreadyEaten = log.totals.calories != null
    ? `Already eaten today: ${fmtTotals(log.totals)}.`
    : "Nothing tracked as eaten yet today.";

  const windows = targets
    .map(m => `${m}: ${prefs.meal_windows[m].start}–${prefs.meal_windows[m].end}`)
    .join(", ");


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content: `You plan meals at a campus dining hall. Pick real plates from today's menu.

It is ${now.toFormat("cccc, yyyy-MM-dd HH:mm")} (${tz}); planning ${day} for: ${targets.join(", ")}.
Meal windows: ${windows}. Calendar that day: ${busyText}.
Macro shorthand: 310c 34p 6cb 16f = calories, protein g, carbs g, fat g.

HARD RULES:
- NEVER include anything containing a disliked food: ${prefs.dislikes.join(", ") || "(none)"}.
  If a station's best option conflicts, pick a different station — say so in the reason.
- Item names must be EXACT names from the menu below, from the meal being planned.
- 2 to 5 items per meal, a real plate: a protein anchor plus sides. The salad
  bar and other all-day stations may supplement any meal.

AIM FOR:
- Daily targets: ${prefs.calorie_target || "unspecified"} calories, ${prefs.protein_target || "unspecified"} g protein. ${alreadyEaten}
  Split the remainder sensibly across the meals being planned.
- Protein quality first, then variety. They like: ${prefs.likes.join(", ") || "(none noted)"}.
- target_time inside the meal's window, avoiding the calendar above.
${note ? `- The user added: ${note}` : ""}

MENU:
${menuBrief(dayData, { meals: targets })}

Return JSON:
{"meals":[{"meal":"Dinner","station":"<primary station>","items":[{"name":"<exact menu name>","station":"<its station>","quantity":1}],"target_time":"17:00","reason":"<=12 words"}]}`
      },
      { role: "user", content: note || `Plan ${targets.join(" and ").toLowerCase()} for ${day}.` }
    ]

  });


  let picks = [];

  try {
    picks = JSON.parse(response.choices[0].message.content).meals || [];
  } catch {
    return { success: false, message: "The planner returned something unreadable — try again." };
  }


  const index = itemIndex(dayData);

  // Re-planning replaces — but only once there is something to replace it WITH.
  //
  // This used to delete every targeted meal's rows and calendar blocks up here,
  // before a single pick had been validated. Three ways that ate a plan and
  // gave nothing back:
  //
  //   · the planner returns picks whose item names are not on the menu, they
  //     all die in validation below, and the function returns "Couldn't build a
  //     plan" — with the dinner it just deleted, and its calendar block, gone;
  //   · the planner returns `{"meals": []}`, or uses a different key, so `picks`
  //     is empty and the loop never runs at all;
  //   · worst, because it reports success: the Plan button sends no `meals`, so
  //     targets is EVERY remaining meal. Both lunch and dinner are deleted, the
  //     planner answers for dinner only, and the call returns success describing
  //     dinner while lunch and its calendar block are gone unmentioned.
  //
  // So the delete now happens per meal, after that meal's replacement row has
  // actually landed. The worst case flips from losing a plan to briefly holding
  // two, which is visible and fixable rather than silent and not.
  const replaced = [];
  const removed = new Set();

  const replaceStale = async (meal) => {

    for (const row of log.planned.filter(r => r.meal === meal && !removed.has(r.id))) {

      removed.add(row.id);

      await removeLogEntry({ id: row.id }).catch(error =>
        console.error("STALE PLAN REMOVE FAILED:", error.message)
      );

      replaced.push(meal);

    }

  };


  const plans = [];
  const skipped = [];

  for (const pick of picks) {

    if (!targets.some(t => t.toLowerCase() === String(pick.meal || "").toLowerCase())) continue;

    const meal = targets.find(t => t.toLowerCase() === String(pick.meal).toLowerCase());

    // Validation is where hallucinated items die, visibly.
    const items = [];
    const lost = [];

    for (const it of pick.items || []) {
      const found = findMenuItem(index, meal, it.name) || findMenuItem(index, "All day", it.name);
      if (found) items.push(asLogItem(found, Number(it.quantity) || 1));
      else lost.push(it.name);
    }

    if (items.length === 0) {
      skipped.push(`${meal} (nothing the planner picked exists on the menu)`);
      continue;
    }

    const totals = {
      calories: sumField(items, "calories"),
      protein_g: sumField(items, "protein_g")
    };

    const window = prefs.meal_windows[meal];

    const slot = findFreeSlot({
      busy,
      day,
      window,
      preferred: /^\d{1,2}:\d{2}$/.test(pick.target_time || "") ? pick.target_time : null,
      minutes: prefs.meal_minutes,
      tz
    });

    let eventId = null;
    let eventNote = null;

    if (slot) {

      const station = pick.station || items[0].station;

      const created = await createEvent({
        title: `${meal} — ${station}`,
        year: slot.year,
        month: slot.month,
        day: slot.day,
        hour: slot.hour,
        minute: slot.minute,
        timezone: tz,
        durationMinutes: prefs.meal_minutes,
        description: [
          items.map(i => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name} (${i.station})`).join("\n"),
          "",
          fmtTotals(totals),
          pick.reason ? `Why: ${pick.reason}` : null
        ].filter(v => v != null).join("\n")
      }).catch(error => {
        console.error("MEAL PLAN EVENT FAILED:", error.message);
        return null;
      });

      eventId = created?.data?.id || null;

      if (!created) eventNote = "calendar event failed";

      // The new block is busy for the next meal in this same run.
      busy.push({ start: slot, end: slot.plus({ minutes: prefs.meal_minutes }), title: meal });

    } else {

      eventNote = "no open slot in the window";

    }

    const logged = await logMealItems({
      items,
      meal,
      date: day,
      status: "planned",
      station: pick.station || items[0].station,
      source: "planner",
      event_id: eventId,
      // Human text the Plan tab shows verbatim — the slot leads because "when"
      // is the first thing a plan answers.
      note: [
        slot ? slot.toFormat("h:mm a") : null,
        pick.reason,
        eventNote,
        lost.length ? `couldn't find: ${lost.join(", ")}` : null
      ].filter(Boolean).join(" · ") || null
    });

    if (!logged.success) return logged;

    // Only now — the new plan for this meal exists, so the old one can go.
    await replaceStale(meal);

    plans.push({
      meal,
      station: pick.station || items[0].station,
      items,
      totals,
      at: slot ? slot.toFormat("h:mm a") : null,
      reason: pick.reason || null,
      event_id: eventId
    });

  }


  if (plans.length === 0) {
    return {
      success: false,
      message: `Couldn't build a plan${skipped.length ? ` — ${skipped.join("; ")}` : ""}. Try asking differently.`
    };
  }

  const spoken = plans.map(p =>
    `${p.meal}${p.at ? ` at ${p.at}` : ""}: ${p.station} — ${p.items.map(i => i.name).join(", ")} (${fmtTotals(p.totals)})`
  ).join(". ");

  const extras = [
    skipped.length ? `Skipped ${skipped.join("; ")}` : null,
    plans.some(p => !p.at) ? "No calendar block for the meals with no open slot" : null
  ].filter(Boolean).join(". ");

  return {
    success: true,
    message: `${spoken}.${extras ? ` ${extras}.` : ""}`,
    data: { date: day, plans, replaced: [...new Set(replaced)] }
  };

}


// ---------------------------------------------------------------------------
// The intelligence layer's view of nutrition.
// ---------------------------------------------------------------------------

// One line for lib/signals.js: what was eaten lately against the targets.
// Null (no line) when tracking isn't set up or nothing has been logged — the
// signal must never manufacture a zero-calorie week out of an empty table.
export async function nutritionSignal() {

  const tz = await getUserTimezone();

  const today = DateTime.now().setZone(tz);

  const since = today.minus({ days: 7 }).toISODate();

  const { data, error } = await supabase
    .from("dining_log")
    .select("date, status, calories, protein_g")
    .gte("date", since)
    .eq("status", "eaten");

  if (error || !data || data.length === 0) return null;

  const prefs = await getDiningPrefs();

  const byDay = new Map();

  for (const row of data) {
    const entry = byDay.get(row.date) || { calories: 0, protein: 0, any: false };
    if (row.calories != null) { entry.calories += Number(row.calories); entry.any = true; }
    if (row.protein_g != null) entry.protein += Number(row.protein_g);
    byDay.set(row.date, entry);
  }

  const tracked = [...byDay.entries()].filter(([, v]) => v.any);

  if (tracked.length === 0) return null;

  const yesterdayKey = today.minus({ days: 1 }).toISODate();
  const yesterday = byDay.get(yesterdayKey);

  const avgCalories = Math.round(tracked.reduce((s, [, v]) => s + v.calories, 0) / tracked.length);
  const avgProtein = Math.round(tracked.reduce((s, [, v]) => s + v.protein, 0) / tracked.length);

  const parts = [];

  if (yesterday?.any) {
    parts.push(`yesterday ${Math.round(yesterday.calories)} cal / ${Math.round(yesterday.protein)}g protein`);
  }

  parts.push(`${tracked.length}-day avg ${avgCalories} cal / ${avgProtein}g protein`);

  if (prefs.calorie_target || prefs.protein_target) {
    parts.push(`target ${prefs.calorie_target || "—"} cal / ${prefs.protein_target || "—"}g`);
  }

  return `${parts.join("; ")}.`;

}
