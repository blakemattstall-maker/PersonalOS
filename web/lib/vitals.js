import supabase from "./supabase.js";
import { DateTime } from "luxon";


// The body, computed once, in code, for every surface at once.
//
// Born from a capture asking for "an analysis of my cut so far" that was
// answered by the FINANCE tool with "no access to a weigh-in trend or start
// weight" — while bodyweight_logs held nineteen dated rows spanning a 51 lb
// documented loss, the freshest logged ninety-six seconds before the question.
// The trend was being fetched on every context build and then dropped one
// stack frame from most prompts; the nudge writer meanwhile did arithmetic on
// a bio sentence ("approximately 220 lbs") written weeks earlier.
//
// Two rules this file enforces:
//   1. Figures are computed here, never by a model (trap #4).
//   2. This is the authoritative weight source. Prose — the bio, a memory, a
//      note — can lag; these logs cannot. Prompts that carry this block also
//      carry the instruction that it outranks prose.


// Pure — handed rows so tests can feed fixtures. Rows may arrive in any order.
export function computeVitalsFromLogs(logs, now = DateTime.now()) {

  const clean = (logs || [])
    .filter(l => l && l.weight != null && l.logged_at)
    .map(l => ({ ...l, at: DateTime.fromISO(l.logged_at) }))
    .filter(l => l.at.isValid)
    .sort((a, b) => a.at.toMillis() - b.at.toMillis());

  if (clean.length === 0) return null;

  const start = clean[0];
  const current = clean[clean.length - 1];
  const unit = current.unit || "lbs";

  const totalChange = Math.round((current.weight - start.weight) * 10) / 10;

  const daysSinceLast = Math.floor(now.diff(current.at, "days").days);

  // Pace over the trailing 30 days, from the actual date span between the
  // first and last log inside the window — not from a per-day average, which
  // sparse weigh-ins would distort. Omitted when the window holds fewer than
  // two logs or they sit closer than three days apart (a span too short to
  // call a rate).
  const windowStart = now.minus({ days: 30 });
  const inWindow = clean.filter(l => l.at >= windowStart);

  let pacePerWeek = null;

  if (inWindow.length >= 2) {
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const spanDays = last.at.diff(first.at, "days").days;
    if (spanDays >= 3) {
      pacePerWeek = Math.round(((last.weight - first.weight) / spanDays) * 7 * 10) / 10;
    }
  }

  return {
    unit,
    start: { weight: start.weight, date: start.at.toFormat("MMM d, yyyy") },
    current: { weight: current.weight, date: current.at.toFormat("MMM d, yyyy") },
    totalChange,
    daysSinceLast,
    pacePerWeek,
    count: clean.length,
    // Newest first, dated — the detail block prompts interpolate.
    recent: clean.slice(-8).reverse()
      .map(l => `${l.at.toFormat("MMM d, yyyy")}: ${l.weight} ${l.unit || unit}`)
  };

}


// One line for buildSignals, so EVERY reasoning surface that renders signals —
// nudges, accountability, the observer, deep thoughts, threads, answers, the
// brief — holds the live figure and can never again prefer a stale bio number.
export function vitalsSignalLine(v) {

  if (!v) return null;

  const change = v.totalChange === 0
    ? "flat"
    : `${v.totalChange > 0 ? "up" : "down"} ${Math.abs(v.totalChange)} ${v.unit}`;

  const pieces = [
    `${v.current.weight} ${v.unit} as of ${v.current.date}`,
    `${change} from ${v.start.weight} on ${v.start.date}`
  ];

  if (v.pacePerWeek != null && v.pacePerWeek !== 0) {
    pieces.push(`~${Math.abs(v.pacePerWeek)} ${v.unit}/week ${v.pacePerWeek < 0 ? "down" : "up"} over the last 30d`);
  }

  if (v.daysSinceLast > 7) {
    pieces.push(`last weigh-in ${v.daysSinceLast} days ago — the trend is going blind`);
  }

  return pieces.join("; ");

}


export async function computeBodyVitals() {

  // Descending, so if the log ever outgrows the limit it is the OLDEST rows
  // that fall off, not the newest — ascending-with-limit would freeze
  // "current weight" at whatever the 2000th oldest entry was, silently, which
  // is trap #21 wearing a different hat. computeVitalsFromLogs sorts
  // ascending itself, so order here is purely about which side truncates.
  // (The one cost: after ~5 years of daily logs, "start" drifts forward to
  // the oldest retained row.)
  const { data, error } = await supabase
    .from("bodyweight_logs")
    .select("weight, unit, logged_at")
    .order("logged_at", { ascending: false })
    .limit(2000);

  if (error) {
    // Absent, not invented — and loud, so a broken read is distinguishable
    // from a person who has never weighed in.
    console.error("VITALS READ FAILED — body line absent from every reasoning call:", error.message);
    return null;
  }

  return computeVitalsFromLogs(data);

}


export async function bodySignal() {

  return vitalsSignalLine(await computeBodyVitals());

}
