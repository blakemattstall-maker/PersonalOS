import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";
import { computeBodyVitals, vitalsSignalLine } from "../lib/vitals.js";
import { getProfile } from "../lib/profile.js";
import { logActivity } from "./activityLog.js";


// The arbiter the system never had.
//
// A morning nudge once told the user to work out off his "current bodyweight"
// — a bio sentence weeks stale — while the real trend sat in bodyweight_logs.
// Nothing in the system ever compared stored prose against fresh measurements,
// and nothing ever asked the user to retire a fact that had gone bad. Dedupe
// arbitrates only at write time, only within one table, so a weigh-in could
// never invalidate a weight claim in a memory or note.
//
// This sweep runs nightly (after the observer, same cron): it collects prose
// rows that make measurable claims, hands them — dated — to a temperature-0
// classifier alongside the live measured figures, and files anything genuinely
// contradicted as a `stale_review` prompt in the dashboard's "needs you"
// queue. The user decides: update, retire, or keep. The sweep NEVER edits or
// deletes data itself — raising its hand is the entire job.

const CLAIM_PATTERN = /(\blbs?\b|\bpounds?\b|\bkg\b|weigh|bodyweight|calorie|protein)/i;

// Where the card tells the user this claim lives. Spelled out rather than
// singularised from the table name — see TYPE_BY_TABLE in lib/links.js for
// what that shortcut costs when the string is load-bearing.
const WHERE_IT_LIVES = {
  memories: "memories",
  notes: "notes",
  intentions: "intentions"
};


// Rows the sweep must not raise again: anything with a review still open, and
// anything the user already ruled "keep" on. Pending-only was a nightly nag
// machine — answer "keep" tonight and the same row came back tomorrow, because
// the claim still contradicts the measurements; that's what keep MEANS.
//
// But "keep" pardons the TEXT, not the row id forever. The bio is rewritten
// weekly under one permanent id and a merged memory is rewritten in place, so
// an id-keyed pardon would exempt a row whose content had since changed
// completely — freezing the one surface this feature exists for out of every
// future sweep. The kept wording is remembered instead, and a row re-enters
// review the moment it no longer says what was pardoned.
async function reviewState() {

  const { data } = await supabase
    .from("prompts")
    .select("payload, status, answer")
    .eq("kind", "stale_review");

  const open = new Set();
  const kept = new Map();

  for (const row of data || []) {

    const key = `${row.payload?.table}:${row.payload?.row_id}`;

    if (row.status === "pending") open.add(key);
    else if (String(row.answer || "").startsWith("keep")) kept.set(key, row.payload?.stored_content || null);

  }

  return { open, kept };

}


async function proseCandidates(table) {

  const { data, error } = await supabase
    .from(table)
    .select("id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.error(`STALENESS SWEEP: ${table} read failed:`, error.message);
    return [];
  }

  return (data || [])
    .filter(row => CLAIM_PATTERN.test(row.content || ""))
    .map(row => ({ ...row, table }));

}


// Exported for tests: the classification is the judgement seam, so its rules
// live in one place.
export function buildClassifierPrompt(evidence, candidates) {

  const list = candidates
    .map((c, i) => `${i}. [${c.table}, noted ${String(c.created_at || "").slice(0, 10) || "date unknown"}] ${c.content}`)
    .join("\n");

  return `The user's live MEASURED data, computed today from real logs:

${evidence}

Stored statements that mention weight or nutrition, each dated:

${list}

Flag ONLY statements a measurement above genuinely contradicts.

Hard rules:
- A goal, target or aspiration ("goal weight 190", "be 190 by winter") is NOT
  stale — it is a want, not a claim about the present. Never flag it.
- A historical statement ("started retatrutide in May", "weighed 267 last
  June") is NOT stale — it was true when it happened. Never flag it.
- Only flag a PRESENT-TENSE claim of current fact that the measurements show
  is now wrong — a stated current weight off by more than ~2 lbs, a "currently
  tracking calories" claim when nothing is logged, and the like.
- When in doubt, do not flag. A wrong flag erodes trust in every future one.

Return ONLY JSON:
{
  "flagged": [
    {
      "index": <number from the list>,
      "stated_claim": "the exact outdated phrase",
      "why": "one clause: what the measurement says instead",
      "suggested_rewrite": "the full statement rewritten with the measured value, or null if it should simply be removed"
    }
  ]
}`;

}


export async function sweepStaleFacts() {

  const vitals = await computeBodyVitals();

  // Nothing measured means nothing to arbitrate with — a sweep that guesses
  // staleness from vibes is worse than no sweep.
  if (!vitals) return { success: true, flagged: 0, skipped: "no measured data" };

  const evidence = `Bodyweight: ${vitalsSignalLine(vitals)}`;

  const [memories, notes, intentions, profile, reviewed] = await Promise.all([
    proseCandidates("memories"),
    proseCandidates("notes"),
    proseCandidates("intentions"),
    getProfile().catch(() => null),
    reviewState()
  ]);

  const candidates = [...memories, ...notes, ...intentions];

  // The bio is prose too — and it is where the stale "approximately 220 lbs"
  // actually lived. It enters the same lineup as one candidate; its remedy on
  // review is a regeneration rather than an edit.
  if (profile?.bio && CLAIM_PATTERN.test(profile.bio)) {
    candidates.push({
      id: profile.id,
      table: "profiles",
      content: profile.bio,
      created_at: profile.updated_at || profile.created_at || null
    });
  }

  const fresh = candidates.filter(c => {

    const key = `${c.table}:${c.id}`;

    if (reviewed.open.has(key)) return false;

    // Pardoned — but only while it still says the pardoned thing.
    if (reviewed.kept.has(key)) {
      const pardoned = reviewed.kept.get(key);
      return pardoned != null && pardoned !== c.content;
    }

    return true;

  });

  if (fresh.length === 0) return { success: true, flagged: 0, skipped: "nothing new to review" };


  let verdict;

  try {

    const response = await openai.chat.completions.create({
      model: MODELS.EXTRACT,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: buildClassifierPrompt(evidence, fresh) }]
    });

    verdict = JSON.parse(response.choices[0].message.content);

  } catch (error) {
    console.error("STALENESS SWEEP CLASSIFY FAILED:", error.message);
    return { success: false, flagged: 0, error: error.message };
  }


  const flagged = (verdict.flagged || [])
    .map(f => ({ ...f, row: Number.isInteger(f.index) ? fresh[f.index] : null }))
    .filter(f => f.row);

  let filed = 0;

  for (const f of flagged) {

    const isBio = f.row.table === "profiles";

    const { error } = await supabase.from("prompts").insert([{
      kind: "stale_review",
      title: "This looks out of date",
      body: `"${f.stated_claim}" — ${f.why}. ${isBio
        ? "It lives in your profile; updating regenerates the bio from current data."
        : `Noted ${String(f.row.created_at || "").slice(0, 10) || "a while ago"} in your ${WHERE_IT_LIVES[f.row.table] || f.row.table}.`}`,
      status: "pending",
      payload: {
        table: f.row.table,
        row_id: f.row.id,
        stored_content: f.row.content,
        stated_claim: f.stated_claim,
        suggested: f.suggested_rewrite || null,
        evidence,
        ...(isBio ? { action: "regenerate" } : {})
      }
    }]);

    if (error) console.error("STALE REVIEW PROMPT INSERT FAILED:", error.message);
    else filed += 1;

  }


  await logActivity({
    action: "staleness_sweep",
    input: null,
    output: { candidates: fresh.length, flagged: flagged.length, filed },
    success: true,
    source: "cron"
  }).catch(error => console.error("STALENESS SWEEP LOG FAILED:", error.message));


  return { success: true, candidates: fresh.length, flagged: flagged.length, filed };

}


// The user's verdict on one stale_review prompt, applied.
//
// "update"  — rewrite the row to the suggested text (the bio instead
//             regenerates, which now folds in measured vitals and heals).
// "retire"  — delete the row outright (the bio, again, regenerates).
// "keep"    — the claim stands; mark reviewed and change nothing.
export async function resolveStaleReview({ prompt_id, answer }) {

  const { data: prompt, error } = await supabase
    .from("prompts")
    .select("payload")
    .eq("id", prompt_id)
    .single();

  if (error || !prompt) {
    return { success: false, error: error?.message || "Prompt not found." };
  }

  const payload = prompt.payload || {};

  let applied = "kept";

  if (answer === "update" || answer === "retire") {

    if (payload.action === "regenerate" || payload.table === "profiles") {

      const { regenerateBio } = await import("./profileEvolution.js");
      const result = await regenerateBio();
      applied = result?.success ? "bio regenerated" : `bio kept (${result?.skipped || "regeneration declined"})`;

    } else if (answer === "retire") {

      const { error: deleteError } = await supabase
        .from(payload.table)
        .delete()
        .eq("id", payload.row_id);

      applied = deleteError ? `delete failed: ${deleteError.message}` : "retired";

    } else if (payload.suggested) {

      const patch = { content: payload.suggested };

      // Memories are retrieved by vector similarity — rewriting content
      // without re-embedding leaves the index pointing at the OLD wording, so
      // semantic search would keep surfacing the row for queries shaped like
      // the stale claim and miss ones shaped like the correction. saveMemory's
      // own merge path re-embeds for exactly this reason; best-effort, same
      // as there — a failed embedding costs ranking quality, never the fix.
      if (payload.table === "memories") {
        const { embed } = await import("../lib/embeddings.js");
        const embedding = await embed(payload.suggested).catch(error => {
          console.error("STALE REVIEW RE-EMBED FAILED:", error.message);
          return null;
        });
        if (embedding) patch.embedding = embedding;
      }

      const { error: updateError } = await supabase
        .from(payload.table)
        .update(patch)
        .eq("id", payload.row_id);

      applied = updateError ? `update failed: ${updateError.message}` : "updated";

      // The rewritten wording may name different entities — keep the graph
      // in step, the same way dedupe's merge path does. The type comes from
      // the registry, never from singularising the table name. Best-effort.
      if (!updateError) {
        await import("../lib/links.js")
          .then(m => {
            const type = m.TYPE_BY_TABLE[payload.table];
            if (!type) return null;
            return m.linkText({ type, id: payload.row_id, text: payload.suggested });
          })
          .catch(error => console.error("STALE REVIEW RELINK FAILED:", error.message));
      }

    } else {

      // Update requested but nothing to update to — safest honest outcome.
      applied = "kept (no rewrite was suggested)";

    }

  }

  await supabase
    .from("prompts")
    .update({ status: "answered", answer: `${answer} — ${applied}`, answered_at: new Date().toISOString() })
    .eq("id", prompt_id);

  return { success: true, applied };

}
