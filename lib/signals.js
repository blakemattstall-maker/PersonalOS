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


export async function buildSignals({ days = 30, tz = "America/Chicago" } = {}) {

  const [finance, completions, overdue] = await Promise.all([
    financeSignal(days),
    completionSignal(days, tz),
    overdueSignal(tz)
  ]);

  const lines = [
    finance && `Money: ${finance}`,
    completions && `Follow-through: ${completions}`,
    overdue && `Outstanding: ${overdue}`
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;

}
