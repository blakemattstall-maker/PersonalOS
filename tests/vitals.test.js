import { test } from "node:test";
import assert from "node:assert";
import { DateTime } from "luxon";

import { computeVitalsFromLogs, vitalsSignalLine } from "../web/lib/vitals.js";


// The figures every reasoning surface now states as fact are computed here,
// in code, never by a model (trap #4). That only holds if the arithmetic is
// actually right — the incident this file exists for began with a model doing
// 220-190=30 on a stale bio sentence while the real logs said 26.


const now = DateTime.fromISO("2026-08-20T14:00:00Z");

const log = (iso, weight) => ({ weight, unit: "lbs", logged_at: iso });

const REAL_SHAPE = [
  log("2025-06-19T15:00:00Z", 267.5),
  log("2026-07-17T15:16:00Z", 222.2),
  log("2026-07-25T18:14:00Z", 219.0),
  log("2026-07-29T15:34:00Z", 217.6),
  log("2026-08-18T13:35:00Z", 216.2),
  log("2026-08-20T13:43:00Z", 216.2)
];


test("start is the earliest log regardless of input order", () => {

  const shuffled = [REAL_SHAPE[3], REAL_SHAPE[0], REAL_SHAPE[5], REAL_SHAPE[1], REAL_SHAPE[4], REAL_SHAPE[2]];

  const v = computeVitalsFromLogs(shuffled, now);

  assert.equal(v.start.weight, 267.5);
  assert.equal(v.current.weight, 216.2);
  assert.equal(v.totalChange, -51.3);

});


test("pace uses the actual date span inside the 30-day window", () => {

  const v = computeVitalsFromLogs(REAL_SHAPE, now);

  // Window (now-30d = Jul 21) holds Jul 25 (219.0) through Aug 20 (216.2):
  // -2.8 lb over ~26 days. Per week: -2.8 / 26.06 * 7 = -0.752… → -0.8.
  assert.equal(v.pacePerWeek, -0.8);

});


test("a window with one log yields no pace, not a fake one", () => {

  const sparse = [log("2025-06-19T15:00:00Z", 267.5), log("2026-08-18T13:35:00Z", 216.2)];

  const v = computeVitalsFromLogs(sparse, now);

  assert.equal(v.pacePerWeek, null);
  assert.equal(v.totalChange, -51.3);

});


test("empty and garbage input yield null, never a fabricated body", () => {

  assert.equal(computeVitalsFromLogs([], now), null);
  assert.equal(computeVitalsFromLogs(null, now), null);
  assert.equal(computeVitalsFromLogs([{ weight: null, logged_at: "2026-08-01" }], now), null);
  assert.equal(computeVitalsFromLogs([{ weight: 216, logged_at: "not a date" }], now), null);

});


test("the signal line carries current, start, and direction", () => {

  const line = vitalsSignalLine(computeVitalsFromLogs(REAL_SHAPE, now));

  assert.match(line, /216\.2 lbs as of Aug 20, 2026/);
  assert.match(line, /down 51\.3 lbs from 267\.5 on Jun 19, 2025/);
  assert.match(line, /0\.8 lbs\/week down/);
  assert.doesNotMatch(line, /NaN|undefined|null/);

});


test("a long weigh-in gap is named, because a blind trend should say so", () => {

  const stale = [log("2025-06-19T15:00:00Z", 267.5), log("2026-08-01T13:00:00Z", 218), log("2026-08-05T13:00:00Z", 217)];

  const line = vitalsSignalLine(computeVitalsFromLogs(stale, now));

  assert.match(line, /last weigh-in 15 days ago/);

});
