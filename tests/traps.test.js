// Regression tests for the traps in docs/PersonalOS-Current-State-Handoff.md.
//
// Each one is documented as having "already bitten, twice". A lesson that lives
// only in a markdown file evaporates the moment the project pauses for two
// months, or the moment a different assistant picks it up. These encode them.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DateTime } from "luxon";

import { taskDueDate } from "../web/tools/googleTasks.js";
import { mapWithConcurrency, coalesce } from "../web/lib/async.js";
import { requireAuth, authEnabled } from "../web/lib/auth.js";
import { DEFAULTS, INTERRUPTION_LEVELS } from "../web/lib/settings.js";


// ---------------------------------------------------------------------------
// Trap #1 — Google Tasks stores a DATE, returned as UTC midnight. Reading it as
// a local timestamp west of UTC rolls every due date back a day.
// ---------------------------------------------------------------------------

test("trap #1: a Google Tasks due date does not shift a day west of UTC", () => {

  const due = taskDueDate("2026-08-05T00:00:00.000Z");

  assert.equal(due.toFormat("yyyy-MM-dd"), "2026-08-05");

  // The actual bug: the same instant read in a western zone.
  assert.equal(
    due.setZone("America/Los_Angeles").toFormat("yyyy-MM-dd"),
    "2026-08-04",
    "sanity check — this IS the shift, which is why comparisons must be yyyy-MM-dd strings"
  );

});


test("trap #1: due-vs-today comparison is a string compare, never an instant compare", () => {

  const due = taskDueDate("2026-08-05T00:00:00.000Z");

  // Today, for a user in US Central time, late in the evening — the moment the
  // instant-comparison version of this got it wrong.
  const today = DateTime.fromISO("2026-08-05T23:30:00", { zone: "America/Chicago" });

  const overdue = due.toFormat("yyyy-MM-dd") < today.toFormat("yyyy-MM-dd");

  assert.equal(overdue, false, "a task due today must never be classified overdue");

  // And the instant comparison that produces the wrong answer, for contrast.
  assert.equal(due.toMillis() < today.toMillis(), true);

});


test("trap #1: taskDueDate tolerates a missing due date", () => {
  assert.equal(taskDueDate(null), null);
  assert.equal(taskDueDate(undefined), null);
  assert.equal(taskDueDate(""), null);
});


// ---------------------------------------------------------------------------
// Trap #3 — never let a model do arithmetic and then narrate it. Overdue
// classification is computed in code. This asserts the classifier is pure and
// deterministic, which is what makes it safe to hand the model as fact.
// ---------------------------------------------------------------------------

test("trap #3: overdue classification is deterministic across timezones", () => {

  const classify = (dueIso, todayIso, zone) => {
    const due = taskDueDate(dueIso).toFormat("yyyy-MM-dd");
    const today = DateTime.fromISO(todayIso, { zone }).toFormat("yyyy-MM-dd");
    return due < today ? "overdue" : due === today ? "due today" : "upcoming";
  };

  for (const zone of ["America/Chicago", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
    assert.equal(classify("2026-08-01T00:00:00.000Z", "2026-08-05T12:00:00", zone), "overdue", zone);
    assert.equal(classify("2026-08-05T00:00:00.000Z", "2026-08-05T12:00:00", zone), "due today", zone);
    assert.equal(classify("2026-08-09T00:00:00.000Z", "2026-08-05T12:00:00", zone), "upcoming", zone);
  }

});


// ---------------------------------------------------------------------------
// lib/async.js — introduced to stop buildPlan blowing the 60s function limit.
// Order preservation is load-bearing: tasks are written with a sequence_order.
// ---------------------------------------------------------------------------

test("mapWithConcurrency preserves input order regardless of completion order", async () => {

  const input = [50, 10, 30, 5, 40, 1];

  const out = await mapWithConcurrency(
    input,
    async ms => { await new Promise(r => setTimeout(r, ms)); return ms; },
    3
  );

  assert.deepEqual(out, input);

});


test("mapWithConcurrency never exceeds its limit", async () => {

  let live = 0;
  let peak = 0;

  await mapWithConcurrency(
    Array.from({ length: 20 }, (_, i) => i),
    async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 5));
      live--;
    },
    4
  );

  assert.ok(peak <= 4, `concurrency peaked at ${peak}, limit was 4`);

});


test("mapWithConcurrency handles an empty list without hanging", async () => {
  assert.deepEqual(await mapWithConcurrency([], async x => x), []);
  assert.deepEqual(await mapWithConcurrency(null, async x => x), []);
});


// ---------------------------------------------------------------------------
// coalesce — one answer for identical concurrent questions.
// ---------------------------------------------------------------------------

test("coalesce runs identical concurrent work once and gives everyone the answer", async () => {

  const map = new Map();

  let runs = 0;

  const work = () => {
    runs += 1;
    return new Promise(resolve => setTimeout(() => resolve("answer"), 20));
  };

  const results = await Promise.all([
    coalesce(map, "same", work),
    coalesce(map, "same", work),
    coalesce(map, "same", work)
  ]);

  assert.equal(runs, 1, "three concurrent callers must produce one call");
  assert.deepEqual(results, ["answer", "answer", "answer"], "every caller still gets the value");

});


test("coalesce keeps different keys apart", async () => {

  const map = new Map();

  const [a, b] = await Promise.all([
    coalesce(map, "a", async () => "A"),
    coalesce(map, "b", async () => "B")
  ]);

  // A key collision would silently hand one caller another's answer, which is a
  // much worse bug than the duplicate request this exists to remove.
  assert.deepEqual([a, b], ["A", "B"]);

});


test("coalesce is not a cache — it forgets as soon as the answer arrives", async () => {

  const map = new Map();

  let runs = 0;

  const work = async () => { runs += 1; return runs; };

  assert.equal(await coalesce(map, "k", work), 1);
  assert.equal(await coalesce(map, "k", work), 2);

  assert.equal(map.size, 0, "a retained entry would make this a cache with no TTL and no invalidation");

});


test("a failure does not poison the key forever", async () => {

  const map = new Map();

  let attempt = 0;

  const flaky = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("first call fails");
    return "recovered";
  };

  await assert.rejects(coalesce(map, "k", flaky), /first call fails/);

  // Cleanup happens in a .finally, so the rejected promise is gone rather than
  // sitting in the map replaying the same error to every future caller.
  assert.equal(map.size, 0);
  assert.equal(await coalesce(map, "k", flaky), "recovered");

});


test("the settings page's duplicate table probes go through one shared function", async () => {

  // /settings issued 46 Supabase round trips, 12 of them byte-identical:
  // buildDiagnostics() counts tables while checkMigrations() probes many of the
  // same ones with the same query, inside the same Promise.all. Both now call
  // probeTable, so the pair costs one request instead of two.
  const diagnostics = fs.readFileSync(new URL("../web/lib/diagnostics.js", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../web/lib/schema.js", import.meta.url), "utf8");

  for (const [name, source] of [["diagnostics.js", diagnostics], ["schema.js", schema]]) {

    assert.match(source, /probeTable/, `${name} must use the shared probe`);

    assert.doesNotMatch(
      source,
      /\.select\("\*", \{ count: "exact", head: true \}\)/,
      `${name} still issues the raw count query the shared probe exists to collapse`
    );

  }

});


test("the TTL caches cannot stampede on a cold container", async () => {

  // A TTL cache does nothing until something is in it, so concurrent callers on
  // a cold start all miss and all query — the one request that most needed the
  // cache was the only one it never helped.
  for (const file of ["profile.js", "settings.js"]) {

    const source = fs.readFileSync(new URL(`../web/lib/${file}`, import.meta.url), "utf8");

    assert.match(source, /coalesce\(inFlight/, `lib/${file} must single-flight its cache fill`);

  }

});


// ---------------------------------------------------------------------------
// Auth — dormant-when-unset is deliberate, but the enforced path must actually
// enforce, and a missing secret must never be satisfiable by a guessable value.
// ---------------------------------------------------------------------------

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}


test("requireAuth is dormant when API_SECRET is unset", () => {

  const saved = process.env.API_SECRET;
  delete process.env.API_SECRET;

  try {
    assert.equal(authEnabled(), false);
    assert.equal(requireAuth({ headers: {} }, fakeRes()), true);
  } finally {
    if (saved !== undefined) process.env.API_SECRET = saved;
  }

});


test("requireAuth rejects a wrong or missing key once API_SECRET is set", () => {

  const saved = process.env.API_SECRET;
  process.env.API_SECRET = "correct-horse";

  try {

    assert.equal(authEnabled(), true);

    const noHeader = fakeRes();
    assert.equal(requireAuth({ headers: {} }, noHeader), false);
    assert.equal(noHeader.statusCode, 401);

    const wrong = fakeRes();
    assert.equal(requireAuth({ headers: { "x-pos-key": "battery-staple" } }, wrong), false);
    assert.equal(wrong.statusCode, 401);

    // The exact string a fail-open template literal would produce.
    const undef = fakeRes();
    assert.equal(requireAuth({ headers: { "x-pos-key": "undefined" } }, undef), false);

    assert.equal(requireAuth({ headers: { "x-pos-key": "correct-horse" } }, fakeRes()), true);

  } finally {
    if (saved === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = saved;
  }

});


// The cron route used to compare against `Bearer ${process.env.CRON_SECRET}`,
// which with the variable unset authenticated anyone sending the literal string
// "Bearer undefined". This asserts the source no longer contains that shape.
test("the cron route cannot be authenticated by 'Bearer undefined'", async () => {

  const fs = await import("node:fs");

  const source = fs.readFileSync(new URL("../web/app/api/cron/[job]/handler.js", import.meta.url), "utf8");

  assert.ok(
    !/!==\s*`Bearer \$\{process\.env\.CRON_SECRET\}`/.test(source),
    "the cron handler compares directly against an interpolated env var — an unset CRON_SECRET makes 'Bearer undefined' a valid credential"
  );

});


// ---------------------------------------------------------------------------
// Settings — the interruption dial enforces the single most important product
// decision ("a muted app kills every other feature"). Its default matters even
// when the app_settings table has not been created yet.
// ---------------------------------------------------------------------------

test("the interruption default is the agreed one, and is a valid level", () => {

  assert.equal(DEFAULTS.interruption_level, "digest_plus_urgent");

  assert.ok(INTERRUPTION_LEVELS.includes(DEFAULTS.interruption_level));

  assert.deepEqual(
    INTERRUPTION_LEVELS,
    ["silent", "digest", "digest_plus_urgent", "everything"],
    "levels are persisted as strings in app_settings — reordering or renaming silently changes what a stored value means"
  );

});
