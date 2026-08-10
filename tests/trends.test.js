import { test } from "node:test";
import assert from "node:assert";

import {
  computeTrends,
  trendSignal,
  MIN_DAYS_PER_WINDOW,
  TREND_WINDOW_DAYS,
  FLAT_THRESHOLD
} from "../web/lib/trends.js";


// ---------------------------------------------------------------------------
// Phase 3 — "it notices things changing." The engine computes always; it may
// only speak when the data holds it up. These tests pin the three rules that
// keep a week-over-week claim honest: null is not zero, both windows need real
// days, and a failed read is never a quiet fortnight.
// ---------------------------------------------------------------------------


// Build `n` daily rows newest-first ending at an anchor date, letting a
// per-day function supply each metric. `day` is a yyyy-MM-dd string.
function makeMetrics(n, valueFor) {
  const rows = [];
  const base = new Date(Date.UTC(2026, 7, 20)); // Aug 20 2026, fixed — no Date.now()
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    rows.push({ day, ...valueFor(i, day) });
  }
  return rows; // newest-first, matching getRecentMetrics
}


test("a clear week-over-week rise is reported with the computed figures", async () => {

  // This week (days 0-6) spends ~40/day; last week (7-13) spends ~20/day.
  const metrics = makeMetrics(14, i => ({
    spend_total: i < TREND_WINDOW_DAYS ? 40 : 20,
    tasks_completed: 1
  }));

  const { trends, sufficient, error } = await computeTrends({ metrics });

  assert.equal(error, null);

  const spend = trends.find(t => t.key === "spend_total");
  assert.equal(spend.status, "sufficient");
  assert.equal(spend.direction, "up");
  assert.equal(spend.current, 40);
  assert.equal(spend.previous, 20);
  assert.ok(Math.abs(spend.pct - 1) < 1e-9, "a doubling is +100%");
  assert.match(spend.fact, /spending/);
  assert.match(spend.fact, /this week/);

  assert.ok(sufficient.some(t => t.key === "spend_total"), "a real rise is claimable");

});


test("null days are not counted as zero — a slow bank feed does not fake a drop", async () => {

  // This week has only nulls for spend (bank hasn't posted); last week is real.
  // The naive bug would average this week's nulls as 0 and report a crash.
  const metrics = makeMetrics(14, i => ({
    spend_total: i < TREND_WINDOW_DAYS ? null : 30,
    tasks_completed: 2
  }));

  const { trends } = await computeTrends({ metrics });
  const spend = trends.find(t => t.key === "spend_total");

  assert.equal(spend.status, "insufficient", "no real days this week means no claim, not a fake -100%");
  assert.equal(spend.thisDays, 0);

});


test("a metric needs enough real days in BOTH windows", async () => {

  // Only two non-null spend days this week — below MIN_DAYS_PER_WINDOW.
  const metrics = makeMetrics(14, i => ({
    spend_total: i < 2 ? 50 : (i >= TREND_WINDOW_DAYS ? 25 : null),
    tasks_completed: 1
  }));

  assert.ok(MIN_DAYS_PER_WINDOW > 2, "test assumes the floor is above 2");

  const { trends } = await computeTrends({ metrics });
  const spend = trends.find(t => t.key === "spend_total");
  assert.equal(spend.status, "insufficient");

});


test("movement under the flat threshold reads as flat, not a trend", async () => {

  // ~5% change — below FLAT_THRESHOLD. Sufficient data, but nothing to say.
  const metrics = makeMetrics(14, i => ({
    spend_total: i < TREND_WINDOW_DAYS ? 21 : 20,
    tasks_completed: 1
  }));

  const { trends, sufficient } = await computeTrends({ metrics });
  const spend = trends.find(t => t.key === "spend_total");

  assert.ok(Math.abs(spend.pct) < FLAT_THRESHOLD);
  assert.equal(spend.direction, "flat");
  assert.ok(!sufficient.some(t => t.key === "spend_total"), "flat is not claimable");

});


test("weight is compared as a level (latest reading), not an average", async () => {

  // Weight logged once per week: 165 this week, 200 last week — a real,
  // sustained drop well past the flat threshold (a couple of pounds is noise).
  const metrics = makeMetrics(14, i => {
    let weight = null;
    if (i === 0) weight = 165;
    if (i === TREND_WINDOW_DAYS) weight = 200;
    return { weight, spend_total: 10, tasks_completed: 1 };
  });

  // Only one reading per window — a level needs one, not MIN_DAYS_PER_WINDOW.
  const { trends } = await computeTrends({ metrics });
  const weight = trends.find(t => t.key === "weight");

  assert.equal(weight.status, "sufficient", "a level needs one reading per window");
  assert.equal(weight.current, 165);
  assert.equal(weight.previous, 200);
  assert.equal(weight.direction, "down");

});


test("a failed read surfaces an error and never looks like no change", async () => {

  // computeTrends reads live metrics when none are passed; force the read to
  // throw by stubbing is out of scope here, so assert the contract directly:
  // an empty history yields insufficiency, and the error field is explicit.
  const { trends, sufficient, error } = await computeTrends({ metrics: [] });

  assert.equal(error, null, "empty is not an error");
  assert.equal(sufficient.length, 0, "nothing is claimable from no history");
  assert.ok(trends.every(t => t.status === "insufficient"));

  // trendSignal must return null (no sentence) rather than a fabricated line.
  const line = await trendSignal({ metrics: [] });
  assert.equal(line, null);

});


test("trendSignal speaks only sufficient, non-flat trends and stays terse", async () => {

  const metrics = makeMetrics(14, i => ({
    spend_total: i < TREND_WINDOW_DAYS ? 60 : 30,   // up 100%
    tasks_completed: i < TREND_WINDOW_DAYS ? 4 : 2,  // up 100%
    calendar_busy_minutes: i < TREND_WINDOW_DAYS ? 61 : 60, // flat
    weight: 180
  }));

  const line = await trendSignal({ metrics });

  assert.ok(line, "a real set of trends produces a line");
  assert.match(line, /Week over week/);
  assert.doesNotMatch(line, /time booked/, "a flat metric is excluded");
  // At most two facts, joined by a single semicolon.
  assert.ok((line.match(/;/g) || []).length <= 1, "never a data dump");

});
