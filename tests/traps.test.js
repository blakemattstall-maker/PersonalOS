// Regression tests for the traps in docs/PersonalOS-Current-State-Handoff.md.
//
// Each one is documented as having "already bitten, twice". A lesson that lives
// only in a markdown file evaporates the moment the project pauses for two
// months, or the moment a different assistant picks it up. These encode them.

import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";

import { taskDueDate } from "../tools/googleTasks.js";
import { mapWithConcurrency } from "../lib/async.js";
import { requireAuth, authEnabled } from "../lib/auth.js";
import { DEFAULTS, INTERRUPTION_LEVELS } from "../lib/settings.js";


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

  // Today, for a user in Illinois, late in the evening — the moment the
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

  const source = fs.readFileSync(new URL("../api/cron/[job].js", import.meta.url), "utf8");

  assert.ok(
    !/!==\s*`Bearer \$\{process\.env\.CRON_SECRET\}`/.test(source),
    "api/cron/[job].js compares directly against an interpolated env var — an unset CRON_SECRET makes 'Bearer undefined' a valid credential"
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
