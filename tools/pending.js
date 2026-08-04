import supabase from "../lib/supabase.js";


// The Shortcut is one-shot: it posts text, reads back one message, and ends.
// So "which one did you mean?" was a dead end — the answer arrived as a fresh
// request with no idea a question had been asked, and resolved to nothing.
//
// This gives capture a few minutes of memory. When a modification is genuinely
// ambiguous we park the candidates and the intended action; the next thing the
// user says is matched against those candidates first. If it doesn't match one,
// the parked question is dropped and the utterance routes normally — so an
// unrelated command is never swallowed by a stale question.
//
// Stored in activity_logs rather than a new table: Supabase DDL isn't reachable
// through PostgREST, and this row is genuinely a log entry with a short life.

const ACTION = "pending_clarification";

const TTL_MINUTES = 4;


export async function savePendingClarification({ kind, action, args, candidates, question }) {

  await clearPendingClarification();

  const { error } = await supabase
    .from("activity_logs")
    .insert([{
      action: ACTION,
      input: question,
      output: { kind, action, args, candidates },
      success: true,
      source: "shortcut"
    }]);

  if (error) {
    // Failing to park the question just means the follow-up won't resolve —
    // never a reason to fail the user's actual request.
    console.error("PENDING CLARIFICATION SAVE FAILED:", error.message);
  }

}


export async function getPendingClarification() {

  const cutoff = new Date(Date.now() - TTL_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("activity_logs")
    .select("id, input, output, created_at")
    .eq("action", ACTION)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("PENDING CLARIFICATION LOOKUP FAILED:", error.message);
    return null;
  }

  return data?.[0] || null;

}


export async function clearPendingClarification() {

  const { error } = await supabase
    .from("activity_logs")
    .delete()
    .eq("action", ACTION);

  if (error) {
    console.error("PENDING CLARIFICATION CLEAR FAILED:", error.message);
  }

}
