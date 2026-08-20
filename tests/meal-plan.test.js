import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { DateTime } from "luxon";

import { findFreeSlot } from "../web/tools/mealPlan.js";


const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const mealPlan = read("web/tools/mealPlan.js");
const metrics = read("web/tools/metrics.js");
const signals = read("web/lib/signals.js");
const tools = read("web/lib/toolDefinitions.js");
const router = read("web/lib/router.js");
const tabBar = read("web/app/TabBar.js");
const settings = read("web/lib/settings.js");


// ---------------------------------------------------------------------------
// The slot finder is pure arithmetic over the calendar, so it gets real
// behavioural tests — this is the part where "an open time slot" either means
// something or doesn't.
// ---------------------------------------------------------------------------

const tz = "America/Chicago";

const DINNER = { start: "16:30", end: "20:00", anchor: "17:00" };

const block = (day, from, to) => ({
  start: DateTime.fromISO(`${day}T${from}`, { zone: tz }),
  end: DateTime.fromISO(`${day}T${to}`, { zone: tz }),
  title: "busy"
});


test("an empty evening seats dinner at the anchor", () => {

  const slot = findFreeSlot({ busy: [], day: "2026-08-21", window: DINNER, preferred: null, minutes: 45, tz });

  assert.equal(slot.toFormat("HH:mm"), "17:00");

});


test("a class over the anchor pushes dinner to the next opening, not out of the window", () => {

  const slot = findFreeSlot({
    busy: [block("2026-08-21", "17:00", "18:00")],
    day: "2026-08-21",
    window: DINNER,
    preferred: "17:00",
    minutes: 45,
    tz
  });

  assert.equal(slot.toFormat("HH:mm"), "18:00");

});


test("when everything after the anchor is taken, it looks earlier in the window", () => {

  // Booked solid from 17:30 to close: the only seat for a 45-minute dinner
  // is 16:45, ending exactly as the evening block begins.
  const slot = findFreeSlot({
    busy: [block("2026-08-21", "17:30", "20:00")],
    day: "2026-08-21",
    window: DINNER,
    preferred: "17:00",
    minutes: 45,
    tz
  });

  assert.equal(slot.toFormat("HH:mm"), "16:45");

});


test("a fully booked window yields null, never an overlap", () => {

  const slot = findFreeSlot({
    busy: [block("2026-08-21", "16:00", "20:30")],
    day: "2026-08-21",
    window: DINNER,
    preferred: null,
    minutes: 45,
    tz
  });

  assert.strictEqual(slot, null);

});


test("a preferred time outside the window is clamped into it", () => {

  const slot = findFreeSlot({
    busy: [],
    day: "2026-08-21",
    window: DINNER,
    preferred: "22:00",
    minutes: 45,
    tz
  });

  // 22:00 is after close; the latest a 45-minute dinner can start is 19:15.
  assert.equal(slot.toFormat("HH:mm"), "19:15");

});


// ---------------------------------------------------------------------------
// The decisions that keep the plan and the log honest, pinned as source
// contracts the way canvas-sync.test.js pins its lessons.
// ---------------------------------------------------------------------------

test("dislikes are a hard rule in the planner prompt, with the station-switch instruction", () => {

  assert.match(mealPlan, /NEVER include anything containing a disliked food/);
  assert.match(mealPlan, /pick a different station/);

});


test("re-planning replaces the old plan — rows and calendar blocks — before the new one lands", () => {

  const planner = mealPlan.slice(mealPlan.indexOf("export async function planMeals"));

  const removal = planner.indexOf("removeLogEntry");
  const insert = planner.indexOf("logMealItems");

  assert.ok(removal !== -1 && insert !== -1);
  assert.ok(removal < insert, "stale planned rows are removed before new ones are written");

  // And removing a planned row takes its calendar event with it.
  assert.match(mealPlan, /deleteEventByGoogleId\(data\.event_id\)/);

});


test("the model's picks are validated back to real menu items, and misses die visibly", () => {

  assert.match(mealPlan, /findMenuItem\(index, meal, it\.name\)/);
  assert.match(mealPlan, /nothing the planner picked exists on the menu/);

});


test("planned rows never count as eaten", () => {

  // The day's totals come only from status='eaten'; the nightly rollup and
  // the signal line filter the same way. A planned dinner is an intention.
  assert.match(mealPlan, /rows\.filter\(r => r\.status === "eaten"\)/);
  assert.match(mealPlan, /\.eq\("status", "eaten"\)/);
  assert.match(metrics, /\.eq\("status", "eaten"\)/);

});


test("an unmatched food logs with unknown nutrition, never invented numbers", () => {

  assert.match(mealPlan, /calories: null, protein_g: null, carbs_g: null, fat_g: null/);
  assert.match(mealPlan, /nutrition is unrecorded/);

});


test("a day with nothing tracked stays null in the rollup — untracked is not zero", () => {

  assert.match(metrics, /mealsFailed \|\| dayCalories\.length === 0\s*\?\s*null/);

});


test("a pending dining-log migration costs the nutrition columns, not the night's rollup", () => {

  assert.match(metrics, /error\.code === "PGRST204"/);
  assert.match(metrics, /calories_eaten, protein_eaten, \.\.\.rest/);

});


test("nutrition rides the signal layer, and only once there is data to stand on", () => {

  assert.match(signals, /nutritionSignal\(\)/);
  assert.match(signals, /nutrition && `Food: \$\{nutrition\}`/);
  assert.match(mealPlan, /if \(error \|\| !data \|\| data\.length === 0\) return null;/);

});


test("capture can query, plan, log and set preferences", () => {

  for (const name of ["query_dining", "plan_meals", "log_meal", "set_food_preference"]) {
    assert.match(tools, new RegExp(`name: "${name}"`), `${name} must be declared to the router model`);
    assert.match(router, new RegExp(`case "${name}"`), `${name} must be executable`);
  }

  // Food preferences must land in the structured store the planner reads,
  // not drift into free-text memories the planner never sees.
  assert.match(tools, /Use this instead of save_memory for anything about food/);

});


test("stored dining prefs are deep-merged over defaults, windows included", () => {

  // Settings shallow-replace by key, so a saved {dislikes} would erase the
  // meal windows without this. The defaults file says so; the reader does so.
  assert.match(settings, /getDiningPrefs\(\)/);
  assert.match(mealPlan, /\.\.\.base\.meal_windows/);

});


test("practice is tucked under news, not gone", () => {

  assert.ok(!/href: "\/practice"/.test(tabBar), "practice no longer owns a nav slot");
  assert.match(tabBar, /also: \["\/practice"\]/, "the news tab must cover /practice");
  assert.match(tabBar, /tab\.also \|\| \[\]/, "the active check must honour `also`");

  // The path into practice from the news page has to exist for "tucked
  // under" to be true rather than "removed".
  const news = read("web/app/news/page.js");
  assert.match(news, /href="\/practice"/);

});
