import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  parseStations,
  parseMenus,
  parseItems,
  parseLabel,
  recipeKey
} from "../web/tools/dining.js";


const fixture = (name) =>
  readFileSync(new URL(`./fixtures/dining/${name}`, import.meta.url), "utf8");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const dining = read("web/tools/dining.js");
const cron = read("web/app/api/cron/[job]/handler.js");


// ---------------------------------------------------------------------------
// The parsers run against captured production HTML (school scrubbed). CBORD
// regenerates this markup server-side, so the shapes are stable — but a CBORD
// template update is exactly the failure these exist to catch loudly. If one
// of these breaks, re-capture the panels and compare before touching the
// regexes: the fix is usually one attribute, not a rewrite.
// ---------------------------------------------------------------------------


test("stations come out of the child-units panel with oids and names", () => {

  const stations = parseStations(fixture("stations.html"));

  assert.ok(stations.length >= 10, `expected a full station list, got ${stations.length}`);

  assert.deepEqual(stations[0], { oid: 2, name: "Homestyle" });

  // Entity-carrying names must arrive decoded — this one renders as
  // "Salad Bar &amp; Deli" in the raw HTML.
  assert.ok(stations.some(s => s.name === "Salad Bar & Deli"));

});


test("menus group under their date header, in document order", () => {

  const menus = parseMenus(fixture("menus.html"));

  assert.ok(menus.length >= 6);

  // The fixture's first day serves three meals; all must carry that ISO date.
  assert.deepEqual(menus[0], { date: "2026-08-18", meal: "Breakfast", menuOid: 803959 });
  assert.equal(menus[1].meal, "Lunch");
  assert.equal(menus[2].meal, "Dinner");
  assert.equal(menus[2].date, "2026-08-18");

  // And the next header must switch the date for everything after it.
  assert.ok(menus.some(m => m.date === "2026-08-19"));

  assert.ok(menus.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date)));
  assert.ok(menus.every(m => Number.isFinite(m.menuOid)));

});


test("items carry course, serving size and trait icons", () => {

  const items = parseItems(fixture("items.html"));

  assert.ok(items.length >= 5);

  const salmon = items.find(i => i.name === "Roasted Salmon");

  assert.ok(salmon, "the fixture's first entree must parse");
  assert.equal(salmon.course, "Entrees");
  assert.equal(salmon.serving, "Salmon Fillet");
  assert.deepEqual(salmon.traits, ["Fish"]);
  assert.ok(Number.isFinite(salmon.detailOid));

  // Course headers are rows too — they must assign, not appear as items.
  assert.ok(items.every(i => i.name !== "Entrees" && i.name !== "Sides"));
  assert.ok(items.every(i => i.course));

});


test("the nutrition label parses numbers, keeps NA as null, and reads Contains:", () => {

  const label = parseLabel(fixture("label.html"));

  assert.equal(label.name, "Roasted Salmon");
  assert.match(label.serving, /Salmon Fillet/);

  assert.equal(label.nutrition.calories, 240);
  assert.equal(label.nutrition.fat_g, 15.22);
  assert.equal(label.nutrition.fat_dv, 20);
  assert.equal(label.nutrition.sat_fat_g, 3.459);
  assert.equal(label.nutrition.cholesterol_mg, 62);
  assert.equal(label.nutrition.sodium_mg, 657);
  assert.equal(label.nutrition.protein_g, 23.16);
  assert.equal(label.nutrition.vitamin_c_dv, 4);

  // The school leaves carbohydrate fields blank on this recipe — NA must
  // arrive as null, never 0 or NaN: zero carbs is a claim, null is honesty.
  assert.strictEqual(label.nutrition.carbs_g, null);
  assert.strictEqual(label.nutrition.fiber_g, null);
  assert.strictEqual(label.nutrition.trans_fat_g, null);

  assert.match(label.ingredients, /ATLANTIC SALMON/);
  assert.deepEqual(label.allergens, ["Fish"]);

});


test("recipe keys are stable across formatting noise", () => {

  assert.equal(
    recipeKey("  Steamed   Rice ", "1/2 Cup"),
    recipeKey("Steamed Rice", "1/2  CUP")
  );

  // Serving size is part of identity: the 4oz and 6oz ladles of the same soup
  // are different labels and must never share a cache entry.
  assert.notEqual(
    recipeKey("Broccoli Soup", "4 Oz"),
    recipeKey("Broccoli Soup", "6 Oz")
  );

});


// ---------------------------------------------------------------------------
// The decisions that keep the sync inside Vercel's window and the data
// trustworthy, pinned the same way canvas-sync.test.js pins its lessons.
// ---------------------------------------------------------------------------


test("the sync spends its budget nearest-dates-first", () => {

  // When the budget expires, it must expire on day 12 — not on tomorrow's
  // lunch. The worklist sort is what guarantees that.
  const sync = dining.slice(dining.indexOf("export async function syncDiningMenus"));

  assert.ok(sync.includes("work.sort"), "the worklist must be sorted before spending budget");
  assert.match(sync, /a\.date < b\.date/, "sorted by date ascending");

});


test("a menu row is only written after every one of its labels", () => {

  // A budget that expires mid-menu must leave no row: a half-labelled menu
  // reads as synced forever, because the diff only refreshes near dates.
  const sync = dining.slice(dining.indexOf("export async function syncDiningMenus"));

  const labelLoop = sync.indexOf("for (const item of items)");
  const menuWrite = sync.indexOf('from("dining_menus").upsert');

  assert.ok(labelLoop !== -1 && menuWrite !== -1);
  assert.ok(labelLoop < menuWrite, "labels are fetched before the menu row is upserted");

});


test("every sync run leaves a durable record, success or not", () => {

  assert.match(dining, /action: "dining_sync"/, "the run must log to activity_logs");
  assert.match(dining, /result\.errors\.length === 0/, "success must mean nothing errored");
  assert.match(dining, /DINING SYNC LOG FAILED/, "a logging failure must not take down the sync");

});


test("the dining sync rides the Canvas cron slot without endangering it", () => {

  // Promise.allSettled, not Promise.all: a dining-site outage must never cost
  // the morning's Canvas assignments, nor the reverse.
  const job = cron.slice(cron.indexOf("async function syncCanvas"));

  assert.match(job, /Promise\.allSettled\(\[\s*syncCanvasAssignments\(\),\s*syncDiningMenus/);

});


test("the label cache is keyed by recipe, not by menu appearance", () => {

  // Fetching a label once per (name, serving) ever — instead of once per
  // appearance — is the entire reason a nightly sync fits in 40 seconds.
  assert.match(dining, /if \(recipes\.has\(key\)\) continue;/);

});
