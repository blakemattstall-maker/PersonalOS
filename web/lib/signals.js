import { DateTime } from "luxon";
import supabase from "./supabase.js";
import { spendSummary } from "./money.js";
import { trendSignal } from "./trends.js";
import { FALLBACK_TIMEZONE } from "./profile.js";


// A compact cross-domain snapshot, shared by every tool that reasons.
//
// Until now each tool saw exactly one source: the finance tool knew spending
// and nothing else, deep thinking knew the bio and nothing else. Nothing could
// say "you're overspending in a week you also missed three deadlines", because
// nothing ever held both facts at once.
//
// Deliberately terse — a few dozen tokens, not a data dump. This rides along
// in every nudge, deep thought and general question, so raw transaction lists
// here would multiply the cost of the whole system. Anything wanting detail
// calls the domain tool directly.
//
// Every number is computed here rather than by the model, for the same reason
// the finance and overdue paths compute theirs: models narrate, they don't
// tally.

const money = n => `$${Math.abs(n).toFixed(0)}`;


// This line is the most widely read number in the system — it rides inside
// buildRichContext() into the brief, the observer, every nudge evaluation,
// deep thinking, general questions, news ranking, Gmail and Docs.
//
// It used to total every negative row, with no idea the `transfers` category
// existed, so it reported $2,156 out for the same 30 days the money page
// labelled $711 — three Zelle transfers counted as purchases, and named as the
// biggest one. Every judgment the system made about money was made against a
// figure three times too large. It now takes its totals from lib/money.js,
// which is the same summariser the page prints.
async function financeSignal(days) {

  try {

    const s = await spendSummary({ days });

    if (s.transactionCount === 0 && s.transfersOut.length === 0) return null;

    const top = s.merchants
      .slice(0, 4)
      .map(m => `${m.merchant} ${money(m.total)}`)
      .join(", ");

    // Transfers are named rather than silently dropped. Saying "out $711"
    // while $1,445 also left the account would be its own kind of wrong, and
    // the difference between the two is exactly what a reasoning call needs in
    // order not to re-derive it badly.
    const transfers = s.transferTotal > 0
      ? ` Separately, ${money(s.transferTotal)} moved out as transfers (Zelle, Venmo, cash) — not spending.`
      : "";

    return `Balance ${money(s.balance)}. Last ${days}d: out ${money(s.spent)}, in ${money(s.earned)} across ${s.transactionCount} purchases.`
      + (top ? ` Biggest: ${top}.` : "")
      + transfers;

  } catch (error) {
    // Banking being unreachable must never take down a deep thought.
    console.error("SIGNAL finance FAILED:", error.message);
    return null;
  }

}


// Why every signal below announces a query failure out loud.
//
// Each one returned null for two completely different situations: "there is
// nothing to report" and "the query is broken". That is not a hypothetical
// confusion — projectSignal selected `projects.title`, a column that has never
// existed (it is `name`), so the query errored on every single run, the error
// was swallowed here, and the Projects line has been silently missing from
// every brief, every observation and every nudge evaluation since it was
// written. Nothing anywhere said so.
//
// The null return stays: one broken signal must not take down a brief. What
// changes is that it can no longer be mistaken for a quiet week.
function queryFailed(name, error) {

  console.error(
    `SIGNAL "${name}" QUERY FAILED — this signal is now silently absent from ` +
    `buildSignals() and therefore from every reasoning call in the system, ` +
    `until it is fixed: ${error.message}`
  );

  return null;

}


async function completionSignal(days, tz) {

  const since = DateTime.now().minus({ days }).toISO();

  const { data, error } = await supabase
    .from("activity_logs")
    .select("input, output, created_at")
    .eq("action", "task_completed")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) return queryFailed("completions", error);

  if (!data || data.length === 0) return null;

  const late = data.filter(d => (d.output?.days_late ?? 0) > 0);

  const worst = late
    .slice()
    .sort((a, b) => (b.output?.days_late || 0) - (a.output?.days_late || 0))[0];

  return `Finished ${data.length} task${data.length === 1 ? "" : "s"} in ${days}d; ${late.length} ${late.length === 1 ? "was" : "were"} late`
    + (worst ? `, worst by ${worst.output.days_late}d ("${String(worst.input).slice(0, 40)}")` : "")
    + ".";

}


async function overdueSignal(tz) {

  const todayKey = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");

  const { data, error } = await supabase
    .from("tasks")
    .select("title, due_date")
    .neq("status", "completed")
    .not("due_date", "is", null)
    .lt("due_date", todayKey);

  if (error) return queryFailed("overdue", error);

  if (!data || data.length === 0) return null;

  return `${data.length} task(s) currently past due.`;

}


// Things the user SAID he wanted to do, that nothing has happened on.
//
// This was the largest hole in the accountability story. The observer could see
// money, tasks and weight, so it could notice overspending — but "you haven't
// read a book in two months" was literally invisible to it, because intentions
// were never in its field of view. The user named exactly that example when
// asking what the app watches, and the honest answer was: not this.
//
// Age is the signal. An intention nobody has touched in weeks is the one worth
// raising; one saved yesterday is not.
async function intentionSignal(tz) {

  const { data, error } = await supabase
    .from("intentions")
    .select("content, created_at, status")
    .neq("status", "completed")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) return queryFailed("intentions", error);

  if (!data || data.length === 0) return null;

  const now = DateTime.now().setZone(tz);

  const aged = data
    .map(i => ({
      content: i.content,
      days: Math.floor(now.diff(DateTime.fromISO(i.created_at), "days").days)
    }))
    .filter(i => i.days >= 14)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  if (aged.length === 0) {
    return `${data.length} open intention(s), none older than two weeks.`;
  }

  return `${data.length} open intention(s). Untouched longest: `
    + aged.map(i => `"${i.content.slice(0, 60)}" (${i.days}d)`).join("; ")
    + ".";

}


// Who has gone quiet.
//
// The other half of the same hole — "you haven't seen anyone in a while" was
// unanswerable. Reads the same last_contacted_at the check-in nudges use, but
// reports it as a pattern rather than as one prompt per person, which is what
// lets the observer say something about the shape of a month rather than
// nagging about one name.
async function relationshipSignal(tz) {

  const { data, error } = await supabase
    .from("people")
    .select("name, relationship, last_contacted_at, check_in_days");

  if (error) return queryFailed("relationships", error);

  if (!data || data.length === 0) return null;

  const now = DateTime.now().setZone(tz);

  const withAge = data.map(p => ({
    name: p.name,
    relationship: p.relationship,
    days: p.last_contacted_at
      ? Math.floor(now.diff(DateTime.fromISO(p.last_contacted_at), "days").days)
      : null
  }));

  const contacted = withAge.filter(p => p.days !== null);

  const recent = contacted.filter(p => p.days <= 14).length;

  // Never-logged people are reported separately from long-silent ones: they're
  // different facts. "Never spoken to since saving" usually means the log just
  // isn't being used, and claiming someone was ignored for 200 days on that
  // basis would be wrong.
  const neverLogged = withAge.filter(p => p.days === null).length;

  const quiet = contacted
    .filter(p => p.days >= 21)
    .sort((a, b) => b.days - a.days)
    .slice(0, 4);

  const parts = [
    `${data.length} people saved; ${recent} contacted in the last 14d`,
    neverLogged ? `${neverLogged} with no contact ever logged` : null,
    quiet.length
      ? `quiet longest: ${quiet.map(p => `${p.name}${p.relationship ? ` (${p.relationship})` : ""} ${p.days}d`).join(", ")}`
      : null
  ].filter(Boolean);

  return `${parts.join("; ")}.`;

}


// Projects that stopped moving. A project with a next action and no progress
// for weeks is a different failure from one that was never started.
//
// This selected `title` for as long as it existed. The column is `name` —
// every other file in the repo reads it correctly (tools/brief.js, lib/links.js,
// tools/islands.js) — so PostgREST returned "column projects.title does not
// exist" on every run, the old `if (error || ...) return null` swallowed it,
// and the Projects line never once appeared in a brief, an observation or a
// nudge evaluation. It was written, shipped, and dead on arrival, and the
// system reported itself healthy the whole time. See queryFailed() above for
// the guard that stops the next one lasting as long.
async function projectSignal(tz) {

  const { data, error } = await supabase
    .from("projects")
    .select("name, status, next_action, updated_at")
    .neq("status", "completed")
    .limit(30);

  if (error) return queryFailed("projects", error);

  if (!data || data.length === 0) return null;

  const now = DateTime.now().setZone(tz);

  const stalled = data
    .map(p => ({
      name: p.name,
      next_action: p.next_action,
      days: Math.floor(now.diff(DateTime.fromISO(p.updated_at), "days").days)
    }))
    .filter(p => p.days >= 10)
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);

  if (stalled.length === 0) return `${data.length} active project(s), all touched recently.`;

  return `${data.length} active project(s). Stalled: `
    + stalled.map(p => `"${p.name}" ${p.days}d${p.next_action ? ` (next: ${p.next_action.slice(0, 40)})` : ""}`).join("; ")
    + ".";

}


// Where he has actually been.
//
// The largest dataset in the system — over a thousand stored points — and it
// has never been visible to anything that reasons. The brief could tell you
// what was on your calendar and never that you spent nine hours somewhere that
// was not on it. Reported as time at named places over a week, because a
// coordinate is not a fact anyone can use and a single day is not a pattern.
//
// Unlabelled places are counted but not named. "You spent 6h somewhere I don't
// have a name for" is honest and is itself a nudge to label it; inventing a
// description of a coordinate would not be.
async function presenceSignal(tz) {

  const { visitsInWindow } = await import("../tools/location.js");

  const visits = await visitsInWindow({ days: 7, tz });

  if (visits.length === 0) return null;

  const byPlace = new Map();

  for (const visit of visits) {
    const key = visit.label || null;
    const entry = byPlace.get(key) || { minutes: 0, visits: 0 };
    entry.minutes += visit.minutes;
    entry.visits += 1;
    byPlace.set(key, entry);
  }

  const named = [...byPlace.entries()]
    .filter(([label]) => label)
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .slice(0, 4)
    .map(([label, v]) => `${label} ${Math.round(v.minutes / 60)}h across ${v.visits} visit(s)`);

  const unnamed = [...byPlace.entries()].filter(([label]) => !label);

  const unnamedMinutes = unnamed.reduce((total, [, v]) => total + v.minutes, 0);

  const parts = [
    named.length ? named.join(", ") : null,
    unnamedMinutes > 60
      ? `${Math.round(unnamedMinutes / 60)}h at ${unnamed.length} place(s) with no label yet`
      : null
  ].filter(Boolean);

  if (parts.length === 0) return null;

  return `Last 7d — ${parts.join("; ")}.`;

}


export async function buildSignals({ days = 30, tz = FALLBACK_TIMEZONE } = {}) {

  // Every signal is independently optional. One table missing or one query
  // failing must degrade that line only — a signals build that throws would
  // take the observer, deep thinking and every reasoning tool down with it.
  const results = await Promise.allSettled([
    financeSignal(days),
    completionSignal(days, tz),
    overdueSignal(tz),
    intentionSignal(tz),
    relationshipSignal(tz),
    projectSignal(tz),
    presenceSignal(tz),
    // The live weigh-in figures — start, current, pace — computed in
    // lib/vitals.js. Rides here rather than as a separate context field
    // because signals is the one block every reasoning surface renders: a
    // morning nudge once did arithmetic on the bio's stale "approximately
    // 220 lbs" while the real trend sat in a context field its prompt never
    // interpolated.
    import("../lib/vitals.js").then(m => m.bodySignal()),
    // What was eaten against the targets — null until meals are tracked, so
    // the food line only exists once there is food data to stand on.
    import("../tools/mealPlan.js").then(m => m.nutritionSignal()),
    // Phase 3 — the one line that says what CHANGED, not just what is. Returns
    // null (no line) until there is enough non-null history to compare, so on
    // today's data it costs a signal slot and adds nothing; the moment two real
    // weeks exist for a metric, week-over-week movement rides into every
    // reasoning call for free. Computed in lib/trends.js, never by the model.
    trendSignal(),
    // What the app has standing instructions to do on its own. Without this
    // line the nudge writer cannot know a reminder already exists and will
    // cheerfully tell him to go and set one up — the exact failure the trigger
    // engine was built to end.
    import("../tools/triggers.js").then(m => m.triggerSignal())
  ]);

  const [finance, completions, overdue, intentions, relationships, projects, presence, body, nutrition, trends, standing] =
    results.map(r => (r.status === "fulfilled" ? r.value : null));

  // A rejected signal is a bug, not a quiet week — allSettled keeps it from
  // taking the others down, but it must not disappear the way projectSignal's
  // swallowed query error did.
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`SIGNAL #${index} THREW — absent from every reasoning call:`, result.reason?.message);
    }
  });

  const lines = [
    finance && `Money: ${finance}`,
    completions && `Follow-through: ${completions}`,
    overdue && `Outstanding: ${overdue}`,
    intentions && `Stated intentions: ${intentions}`,
    relationships && `Relationships: ${relationships}`,
    projects && `Projects: ${projects}`,
    presence && `Where he has been: ${presence}`,
    body && `Body: ${body}`,
    nutrition && `Food: ${nutrition}`,
    trends && `Trends: ${trends}`,
    standing && `Already handled: ${standing}`
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;

}
