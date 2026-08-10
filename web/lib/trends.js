import { DateTime } from "luxon";
import { getRecentMetrics } from "../tools/metrics.js";


// Phase 3 — "it notices things changing."
//
// Every other reasoning surface in this system knows what is true *today*. This
// is the one place that knows what changed. It compares the most recent window
// of daily_metrics against the window before it and reports the movement.
//
// It obeys the two rules the whole app is built on, and a third that only
// matters here:
//
//   1. COMPUTE IN CODE, PHRASE WITH THE MODEL. Every number below is tallied
//      here. The model that later narrates a trend is handed the figure as a
//      fact and told never to recompute or invent one — same contract as
//      lib/money.js and lib/signals.js.
//
//   2. A FAILED READ MUST NOT LOOK LIKE A QUIET WEEK. If the metrics query
//      throws, computeTrends surfaces { error } and trendSignal returns null
//      loudly — it never returns "no change", because "no change" is a claim.
//
//   3. NULL IS NOT ZERO, AND IT IS NOT A DATA POINT. daily_metrics writes null
//      for "not measured that day" (metrics.js:20) — a day the bank had not
//      posted yet, a day with no location. Averaging null as zero would invent
//      a spending drop out of a slow-to-settle bank feed. Every window here
//      counts ONLY non-null days, per metric, and refuses to claim a trend for
//      a metric until BOTH windows clear MIN_DAYS_PER_WINDOW real days. This is
//      why, on sixteen days of history where six have no settled spend, most
//      metrics correctly report `insufficient` rather than a fake swing.
//
// The gate is a RUNTIME check, not a reason to defer building this: the engine
// computes always and speaks only when the data holds it up. Tune the
// thresholds in September when there is a distribution to look at; the shape
// does not change.


// Each comparison window is one week. Two of them need fourteen days of
// history to fill, which is the same floor the observer already refuses to
// claim trends below (MIN_DAYS_FOR_TRENDS).
export const TREND_WINDOW_DAYS = 7;

// A metric needs at least this many non-null days in EACH window before its
// movement is claimable. Three is enough that one stray day cannot invent a
// swing, and low enough that a real week of data qualifies.
export const MIN_DAYS_PER_WINDOW = 3;

// Movement smaller than this reads as flat. Week-to-week noise on a personal
// dataset is large; only a change big enough to be worth a once-a-day message
// should ever surface.
export const FLAT_THRESHOLD = 0.15;


// How each metric is compared and phrased. `kind` decides the arithmetic:
//   flow  — a quantity that accumulates through a day (money, tasks, minutes).
//           Compared as a mean PER MEASURED DAY, so two windows with different
//           numbers of null days are still comparable.
//   level — a standing value that is simply true at a moment (weight).
//           Compared as the most recent real reading in each window.
// No metric carries a value judgement here — "up" and "down" are facts; whether
// a rise in spending is worth interrupting for is the observer's call, not this
// file's.
const METRIC_SPECS = [
  { key: "spend_total",          label: "spending",        kind: "flow",  unit: "$",  digits: 0 },
  { key: "tasks_completed",      label: "tasks finished",  kind: "flow",  unit: "",   digits: 1 },
  { key: "tasks_completed_late", label: "late completions", kind: "flow", unit: "",   digits: 1 },
  { key: "calendar_busy_minutes", label: "time booked",    kind: "flow",  unit: "h",  digits: 1, scale: 1 / 60 },
  { key: "minutes_at_gym",       label: "gym time",        kind: "flow",  unit: "h",  digits: 1, scale: 1 / 60 },
  { key: "places_visited",       label: "places visited",  kind: "flow",  unit: "",   digits: 1 },
  { key: "weight",               label: "weight",          kind: "level", unit: "lb", digits: 1 }
];


function fmt(value, spec) {
  const scaled = value * (spec.scale ?? 1);
  const body = scaled.toFixed(spec.digits);
  return spec.unit === "$" ? `$${body}` : `${body}${spec.unit}`;
}


// One metric, two windows of already-bucketed daily rows. Pure — no I/O, so a
// test can hand it fixtures and a caller can hand it the live read.
function trendForMetric(spec, thisWindow, lastWindow) {

  const pick = rows => rows
    .map(r => r[spec.key])
    .filter(v => v != null && Number.isFinite(v));

  const thisVals = pick(thisWindow);
  const lastVals = pick(lastWindow);

  // A flow (a rate averaged over days) needs several real days per window
  // before an average means anything; a level (a standing value like weight)
  // needs just one real reading in each window, because it is not averaged.
  const minPerWindow = spec.kind === "level" ? 1 : MIN_DAYS_PER_WINDOW;

  // Null is not a data point. A metric only trends once both windows hold
  // enough real days to compare — otherwise it is honestly insufficient, which
  // is a different answer from "flat".
  if (thisVals.length < minPerWindow || lastVals.length < minPerWindow) {
    return {
      key: spec.key,
      label: spec.label,
      status: "insufficient",
      thisDays: thisVals.length,
      lastDays: lastVals.length
    };
  }

  let current, previous;

  if (spec.kind === "level") {
    // The most recent real reading in each window — a level is not an average.
    // thisWindow / lastWindow arrive newest-first, so the first non-null wins.
    current = thisVals[0];
    previous = lastVals[0];
  } else {
    // A rate per measured day, so unequal null counts do not skew it.
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    current = mean(thisVals);
    previous = mean(lastVals);
  }

  const delta = current - previous;

  // Percent change is undefined against a zero baseline — report it as null and
  // let the direction carry the story ("was none, now some") rather than
  // dividing by zero into Infinity.
  const pct = previous !== 0 ? delta / Math.abs(previous) : null;

  let direction;
  if (pct === null) {
    direction = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  } else if (Math.abs(pct) < FLAT_THRESHOLD) {
    direction = "flat";
  } else {
    direction = delta > 0 ? "up" : "down";
  }

  const pctText = pct === null ? null : `${Math.round(Math.abs(pct) * 100)}%`;

  // The phrasing is assembled here, from the computed figures, so a caller can
  // hand it to a model verbatim as a fact. "per day" is stated for flow metrics
  // because the number IS a daily rate, and hiding that would invite the reader
  // to read a weekly total.
  const per = spec.kind === "flow" ? "/day" : "";
  const fact = direction === "flat"
    ? `${spec.label}: ${fmt(current, spec)}${per} this week, about the same as last week`
    : `${spec.label}: ${fmt(current, spec)}${per} this week vs ${fmt(previous, spec)}${per} last week (${direction}${pctText ? ` ${pctText}` : ""})`;

  return {
    key: spec.key,
    label: spec.label,
    status: "sufficient",
    kind: spec.kind,
    current: Number(current.toFixed(4)),
    previous: Number(previous.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    pct: pct === null ? null : Number(pct.toFixed(4)),
    direction,
    thisDays: thisVals.length,
    lastDays: lastVals.length,
    fact
  };
}


// Split the daily rows into two adjacent windows anchored on the newest day
// present, comparing to each row's own date rather than its position — so a gap
// in the history (a day the cron never ran) lands a row in the right window
// instead of shifting every later row across the boundary.
function bucket(metrics) {

  if (!metrics.length) return { thisWindow: [], lastWindow: [] };

  // Newest-first already, but sort defensively — the boundary arithmetic below
  // depends on it and a caller could hand us any order.
  const rows = [...metrics].sort((a, b) => (a.day < b.day ? 1 : -1));

  const anchor = DateTime.fromISO(rows[0].day);

  const ageDays = row => Math.round(anchor.diff(DateTime.fromISO(row.day), "days").days);

  return {
    thisWindow: rows.filter(r => { const a = ageDays(r); return a >= 0 && a < TREND_WINDOW_DAYS; }),
    lastWindow: rows.filter(r => { const a = ageDays(r); return a >= TREND_WINDOW_DAYS && a < TREND_WINDOW_DAYS * 2; })
  };
}


// The engine. Always computes; each metric carries its own sufficiency verdict.
// `metrics` may be passed in (tests, callers that already read the table) or
// left out to read the live window.
export async function computeTrends({ metrics } = {}) {

  let rows = metrics;

  if (!rows) {
    try {
      // Two windows of TREND_WINDOW_DAYS plus a little slack for gaps.
      rows = await getRecentMetrics({ days: TREND_WINDOW_DAYS * 2 + 7 });
    } catch (error) {
      // A read that failed must not read as a quiet fortnight. The caller gets
      // an explicit error, never an empty trend set that looks like "nothing
      // moved".
      console.error(
        "TRENDS read FAILED — no week-over-week movement will be reported to " +
        `any reasoning call until this is fixed: ${error.message}`
      );
      return { error: error.message, trends: [], sufficient: [], anchorDay: null };
    }
  }

  const { thisWindow, lastWindow } = bucket(rows || []);

  const trends = METRIC_SPECS.map(spec => trendForMetric(spec, thisWindow, lastWindow));

  return {
    error: null,
    anchorDay: rows && rows.length ? [...rows].sort((a, b) => (a.day < b.day ? 1 : -1))[0].day : null,
    trends,
    // The subset a narrator is allowed to speak about: enough real days, and a
    // movement large enough not to be noise.
    sufficient: trends.filter(t => t.status === "sufficient" && t.direction !== "flat")
  };
}


// The one line that rides into every reasoning call via buildSignals(). Returns
// null — not a sentence — when nothing is claimable, so the common early case
// (not enough history yet) costs a signal line rather than a paragraph of
// hedging. When it does speak, every figure in it was computed above.
export async function trendSignal({ metrics } = {}) {

  const result = await computeTrends({ metrics });

  // An error already logged itself loudly in computeTrends; here it simply
  // means no trend line, which is correct — better absent than fabricated.
  if (result.error) return null;

  if (!result.sufficient.length) return null;

  // At most two, strongest movement first, so this never becomes the data dump
  // the signals file exists to avoid.
  const top = result.sufficient
    .slice()
    .sort((a, b) => Math.abs(b.pct ?? 1) - Math.abs(a.pct ?? 1))
    .slice(0, 2)
    .map(t => t.fact)
    .join("; ");

  return `Week over week — ${top}.`;
}
