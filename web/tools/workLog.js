import supabase, { selectAll } from "../lib/supabase.js";
import { logActivity } from "./activityLog.js";
import { parseNumbers } from "./triggers.js";


// What he did at work, in order, kept whole.
//
// ── the failure this replaces ────────────────────────────────────────────
//
// A first shift at a new job was captured correctly and written to `memories`.
// Two minutes later, "what have I done for Redbird Creative so far?" came back
// "I don't have any recorded work or accomplishments for Redbird Creative yet."
//
// The immediate cause was routing. The deeper one is that memories are the
// wrong shape for this and would have failed later anyway: retrieval is
// semantic top-N, so forty shift logs return the eight that score highest, and
// a work log has to be COMPLETE rather than relevant. There is also no order to
// them, near-identical entries deduplicate — two similar shifts are two shifts,
// and the boring repetitions are precisely the evidence of volume — and the
// staleness sweep exists to retire claims the present contradicts, which a
// dated record of what happened is not.
//
// So this store is append-only, ordered, never deduplicated, never swept, and
// read WHOLE.


function tableMissing(error) {
  return error && /schema cache|does not exist/i.test(error.message);
}


// "Redbird Creative", "Redbird Athletics", "redbird" — he will not say the same
// name twice, and a log that only answers to its own exact spelling is a log
// that looks empty.
export function orgMatches(stored, asked) {

  const a = String(stored || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const b = String(asked || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  if (!a || !b) return false;

  if (a === b || a.includes(b) || b.includes(a)) return true;

  // Any shared word longer than three characters. "Redbird Creative" and
  // "Redbird Athletics" are the same employer to him.
  const wordsA = new Set(a.split(" ").filter(w => w.length > 3));

  return b.split(" ").some(w => w.length > 3 && wordsA.has(w));

}


// Append. Never merge, never rewrite.
export async function logWork({ org, content, occurred_at = null, project_id = null }) {

  const text = String(content || "").trim();

  if (!org || !text) {
    return { success: false, error: "A work log entry needs both an employer and what you did." };
  }

  const row = {
    org: String(org).trim().slice(0, 120),
    content: text,
    metrics: parseNumbers(text),
    ...(occurred_at ? { occurred_at } : {}),
    ...(project_id ? { project_id } : {})
  };

  const { data, error } = await supabase.from("work_log").insert([row]).select().single();

  if (error) {
    if (tableMissing(error)) {
      return { success: false, error: "The work_log table doesn't exist yet — run docs/schema-work-log.sql in Supabase." };
    }
    throw new Error(error.message);
  }

  await logActivity({
    action: "work_logged",
    input: { org: row.org },
    output: { id: data.id, metrics: row.metrics },
    success: true,
    source: "shortcut"
  }).catch(() => {});

  const { count } = await countFor(row.org);

  return {
    success: true,
    message: `Logged. That's ${count} ${count === 1 ? "entry" : "entries"} for ${row.org}.`,
    data
  };

}


async function countFor(org) {
  const entries = await entriesFor(org);
  return { count: entries.length };
}


// Every entry, not the most relevant ones.
//
// selectAll rather than a bare select: PostgREST caps a response at 1000 rows
// and says nothing about it, and "everything I did this year" is exactly the
// question where a silent truncation would be invisible and wrong.
export async function entriesFor(org) {

  const { rows, error } = await selectAll(
    "work_log",
    "id, org, content, metrics, occurred_at",
    { max: 5000, modify: q => q.order("occurred_at", { ascending: true }) }
  );

  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }

  return org ? rows.filter(r => orgMatches(r.org, org)) : rows;

}


// The whole record, with the arithmetic done in code.
export async function summariseWork({ org = null } = {}) {

  const entries = await entriesFor(org);

  if (entries.length === 0) {
    return {
      success: true,
      found: 0,
      message: org
        ? `Nothing logged for ${org} yet. Tell me what you did after a shift and it goes in from then on.`
        : "No work logged yet."
    };
  }

  // Totals per unit across every entry — 15 GIFs one day and 12 the next is 27,
  // and that is a resume bullet. Computed here, never asked of a model.
  const totals = {};

  for (const entry of entries) {
    for (const [unit, value] of Object.entries(entry.metrics || {})) {
      if (typeof value === "number") totals[unit] = (totals[unit] || 0) + value;
    }
  }

  const first = entries[0].occurred_at;
  const last = entries[entries.length - 1].occurred_at;

  const days = new Set(entries.map(e => String(e.occurred_at).slice(0, 10))).size;

  return {
    success: true,
    found: entries.length,
    org: entries[0].org,
    days,
    first,
    last,
    totals,
    entries: entries.map(e => ({ when: String(e.occurred_at).slice(0, 10), what: e.content })),
    message: `${entries.length} ${entries.length === 1 ? "entry" : "entries"} across ${days} ${days === 1 ? "day" : "days"}.`
  };

}


// The answer to "what have I done for X so far".
//
// The entries are handed over WHOLE and in order, and the model's only job is
// to read them back. It is never asked to recall anything, and never asked to
// count.
export async function answerWorkQuestion({ question, org = null }) {

  const summary = await summariseWork({ org });

  if (summary.found === 0) return summary;

  const { getOpenAI } = await import("../lib/openai.js");
  const { MODELS } = await import("../lib/models.js");

  const response = await getOpenAI().chat.completions.create({
    model: MODELS.JUDGMENT,
    messages: [
      {
        role: "system",
        content:
          "You are answering from a COMPLETE, ordered log of what someone did at a job. " +
          "Every entry is below — nothing is omitted and nothing is summarised away.\n\n" +
          "Answer the question directly and concretely, in his own vocabulary. Name specific " +
          "work. Where the totals below give a figure, use it verbatim; never compute or " +
          "estimate one yourself, and never say 'about' in front of a number that was counted.\n\n" +
          "If he is asking for something to reuse — a LinkedIn post, a resume bullet — write it " +
          "from the real entries rather than describing what could be written.\n\n" +
          "Blunt and specific. No preamble."
      },
      {
        role: "user",
        content: [
          `QUESTION: ${question}`,
          ``,
          `EMPLOYER: ${summary.org}`,
          `${summary.found} entries across ${summary.days} days, ${String(summary.first).slice(0,10)} to ${String(summary.last).slice(0,10)}.`,
          Object.keys(summary.totals).length
            ? `COUNTED TOTALS (use these exactly): ${Object.entries(summary.totals).map(([u,v]) => `${v} ${u.replace(/_/g," ")}`).join(", ")}`
            : "",
          ``,
          `THE LOG, oldest first:`,
          ...summary.entries.map(e => `${e.when} — ${e.what}`)
        ].filter(Boolean).join("\n")
      }
    ]
  });

  return {
    success: true,
    found: summary.found,
    message: response.choices[0].message.content,
    data: { totals: summary.totals, days: summary.days, entries: summary.found }
  };

}


// One line for lib/signals.js, so every reasoning surface knows the log exists.
// Without it the brief and the nudge writer keep saying he has no record of a
// job he has been logging for weeks.
export async function workSignal() {

  const entries = await entriesFor(null).catch(() => []);

  if (entries.length === 0) return null;

  const byOrg = new Map();

  for (const e of entries) {
    const key = e.org;
    if (!byOrg.has(key)) byOrg.set(key, []);
    byOrg.get(key).push(e);
  }

  return [...byOrg.entries()]
    .map(([org, rows]) => {
      const days = new Set(rows.map(r => String(r.occurred_at).slice(0, 10))).size;
      return `${org}: ${rows.length} logged across ${days} ${days === 1 ? "day" : "days"} (latest ${String(rows[rows.length - 1].occurred_at).slice(0, 10)})`;
    })
    .join("; ");

}
