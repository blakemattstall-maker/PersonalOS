import { DateTime } from "luxon";
import supabase from "./supabase.js";
import { getFinancialData } from "./simplefin.js";


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


async function financeSignal(days) {

  try {

    const { accounts } = await getFinancialData({ days });

    const tx = accounts.flatMap(a => a.transactions);

    if (tx.length === 0) return null;

    const out = tx.filter(t => t.amount < 0);
    const spent = out.reduce((s, t) => s + Math.abs(t.amount), 0);
    const inc = tx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const balance = accounts.reduce((s, a) => s + a.balance, 0);

    const byPayee = new Map();

    for (const t of out) {
      const k = (t.payee || t.description).split(/\s+/).slice(0, 3).join(" ");
      byPayee.set(k, (byPayee.get(k) || 0) + Math.abs(t.amount));
    }

    const top = [...byPayee.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k} ${money(v)}`)
      .join(", ");

    return `Balance ${money(balance)}. Last ${days}d: out ${money(spent)}, in ${money(inc)} across ${out.length} purchases. Biggest: ${top}.`;

  } catch (error) {
    // Banking being unreachable must never take down a deep thought.
    return null;
  }

}


async function completionSignal(days, tz) {

  const since = DateTime.now().minus({ days }).toISO();

  const { data, error } = await supabase
    .from("activity_logs")
    .select("input, output, created_at")
    .eq("action", "task_completed")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) return null;

  const late = data.filter(d => (d.output?.days_late ?? 0) > 0);

  const worst = late
    .slice()
    .sort((a, b) => (b.output?.days_late || 0) - (a.output?.days_late || 0))[0];

  return `Finished ${data.length} task(s) in ${days}d; ${late.length} were late`
    + (worst ? `, worst by ${worst.output.days_late}d ("${String(worst.input).slice(0, 40)}")` : "")
    + ".";

}


async function overdueSignal(tz) {

  const todayKey = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");

  const { data } = await supabase
    .from("tasks")
    .select("title, due_date")
    .neq("status", "completed")
    .not("due_date", "is", null)
    .lt("due_date", todayKey);

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

  if (error || !data || data.length === 0) return null;

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

  if (error || !data || data.length === 0) return null;

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
async function projectSignal(tz) {

  const { data, error } = await supabase
    .from("projects")
    .select("title, status, next_action, updated_at")
    .neq("status", "completed")
    .limit(30);

  if (error || !data || data.length === 0) return null;

  const now = DateTime.now().setZone(tz);

  const stalled = data
    .map(p => ({
      title: p.title,
      next_action: p.next_action,
      days: Math.floor(now.diff(DateTime.fromISO(p.updated_at), "days").days)
    }))
    .filter(p => p.days >= 10)
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);

  if (stalled.length === 0) return `${data.length} active project(s), all touched recently.`;

  return `${data.length} active project(s). Stalled: `
    + stalled.map(p => `"${p.title}" ${p.days}d${p.next_action ? ` (next: ${p.next_action.slice(0, 40)})` : ""}`).join("; ")
    + ".";

}


export async function buildSignals({ days = 30, tz = "America/Chicago" } = {}) {

  // Every signal is independently optional. One table missing or one query
  // failing must degrade that line only — a signals build that throws would
  // take the observer, deep thinking and every reasoning tool down with it.
  const results = await Promise.allSettled([
    financeSignal(days),
    completionSignal(days, tz),
    overdueSignal(tz),
    intentionSignal(tz),
    relationshipSignal(tz),
    projectSignal(tz)
  ]);

  const [finance, completions, overdue, intentions, relationships, projects] =
    results.map(r => (r.status === "fulfilled" ? r.value : null));

  const lines = [
    finance && `Money: ${finance}`,
    completions && `Follow-through: ${completions}`,
    overdue && `Outstanding: ${overdue}`,
    intentions && `Stated intentions: ${intentions}`,
    relationships && `Relationships: ${relationships}`,
    projects && `Projects: ${projects}`
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;

}
