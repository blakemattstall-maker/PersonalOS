import openai from "./openai.js";
import supabase from "./supabase.js";
import { MODELS } from "./models.js";
import { linkText } from "./links.js";


// "I already know that."
//
// Capture is deliberately eager: a deep-thinking turn writes memories, the
// router captures intentions from a passing "I've been meaning to", and the
// same fact can arrive through three different doors. That eagerness is the
// right call — a useful feature should never be gated behind saying the magic
// words — but it has an obvious consequence, and nothing was handling it. Two
// runs of the same Shortcut produced two notes with the same university ID;
// three separate turns produced three memories that all say "be blunt with me".
//
// So every capture path now asks this first. Three things can be true of an
// incoming fact, and they need different answers:
//
//   duplicate — already known, in different words. Say so, write nothing.
//   update    — the same subject with new information ("goal weight 190" ->
//               "185"). Replace, and SAY it changed, because silently
//               overwriting something the user told you is how a system starts
//               quietly disagreeing with reality.
//   conflict  — contradicts something without clearly superseding it. Treated
//               as an update but reported prominently; the user is the only
//               one who can actually resolve it.
//
// Cost control: the normalised comparison is free and catches the accidental
// double-tap, which is the common case, without any model call at all. The
// model only runs when something looks new.


// Same fact, different surface. "The user's university ID is 813860967." and
// "User's university ID number is 813860967." must collapse to one thing —
// leading articles, possessives and punctuation carry no meaning here.
export function normalise(text) {

  return String(text || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^(the|a|an)\s+/i, "")
    // Longest forms first: with `i` earlier in the alternation it matches
    // inside "i am" and leaves a stray "am" behind, so the two phrasings this
    // is meant to unify end up differing anyway.
    .replace(/\b(the user's|user's|the user|i'm|i am|user|my|i)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}


// Token overlap, order-insensitive. Cheap prefilter for "worth asking the
// model about" — not a verdict on its own.
function similarity(a, b) {

  const setA = new Set(normalise(a).split(" ").filter(w => w.length > 2));
  const setB = new Set(normalise(b).split(" ").filter(w => w.length > 2));

  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared += 1;

  return shared / Math.min(setA.size, setB.size);

}


const CANDIDATE_LIMIT = 40;

// Above this, the model is asked. Low on purpose: a false trip costs one cheap
// call, a miss costs a duplicate row that lives forever.
const SHORTLIST_THRESHOLD = 0.4;


async function fetchCandidates(table) {

  const { data, error } = await supabase
    .from(table)
    .select("id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);

  // A dedup check that fails must never block the save. Losing a duplicate
  // check costs one redundant row; losing the write costs real data.
  if (error) return [];

  return data || [];

}


async function classify({ content, candidates, kind }) {

  // Dated: "update" and "conflict" are both judgements about which statement
  // is current, and the classifier used to make them blind — two contradictory
  // facts read identically whether the old one was written yesterday or in
  // June. created_at is already fetched by every candidate source.
  const list = candidates
    .map((c, i) => `${i}. [noted ${c.created_at ? String(c.created_at).slice(0, 10) : "date unknown"}] ${c.content}`)
    .join("\n");

  const response = await openai.chat.completions.create({

    model: MODELS.EXTRACT,

    // This is a classification, not a generation. At the default temperature
    // the same borderline pair genuinely returned "new", "update" and
    // "duplicate" across three runs — which would mean whether a duplicate got
    // written depended on luck. Pinned so the same input always decides the
    // same way, and so a wrong call is reproducible enough to actually fix.
    temperature: 0,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Decide whether something the user just said is already
recorded.

New ${kind}:
"${content}"

Already recorded:
${list}

Answer with ONE verdict:

"new"       — genuinely not covered by anything above. This is the most
              common answer. Two facts about the same general area are NOT
              duplicates: "prefers evening workouts" and "lifts four days a
              week" are both worth keeping.

"duplicate" — the same fact, however differently worded. Includes near-misses
              like "the user's ID is 12345" vs "user ID number 12345".

"update"    — same subject, but the new version carries information that
              supersedes the old one. A changed number, a changed date, a
              preference stated more precisely. The old one is now wrong or
              incomplete.

"conflict"  — directly contradicts an existing entry, and you cannot tell
              which is correct. Not simply different — incompatible.

Be conservative: when genuinely unsure between "new" and "duplicate", answer
"new". A duplicate is untidy; wrongly discarding something the user told you
loses real information.

Return ONLY JSON:
{
  "verdict": "new" | "duplicate" | "update" | "conflict",
  "match_index": the index number from the list above, or null for "new",
  "reason": "one short clause",
  "merged_content": "for update/conflict only: the single best version to keep, written as one clean statement. null otherwise"
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


// Same decision, against a caller-supplied list instead of the live table.
//
// Needed by the backfill sweep, which walks a table comparing each row against
// the survivors so far. Using checkDuplicate() there silently does nothing:
// the live table still contains the row being examined, so it matches itself,
// and every real duplicate is reported as new.
export async function checkAgainst({ content, candidates, kind = "note" }) {

  if (!content || !candidates?.length) return { verdict: "new" };

  const incoming = normalise(content);

  const exact = candidates.find(c => normalise(c.content) === incoming);

  if (exact) {
    return { verdict: "duplicate", match: exact, reason: "identical once normalised", viaModel: false };
  }

  const shortlist = candidates
    .map(c => ({ ...c, score: similarity(content, c.content) }))
    .filter(c => c.score >= SHORTLIST_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (shortlist.length === 0) return { verdict: "new" };

  let result;

  try {
    result = await classify({ content, candidates: shortlist, kind });
  } catch (error) {
    console.error("DEDUPE CLASSIFY FAILED:", error.message);
    return { verdict: "new", reason: "dedupe check unavailable" };
  }

  const match = Number.isInteger(result.match_index) ? shortlist[result.match_index] : null;

  if (result.verdict !== "new" && !match) return { verdict: "new", reason: "no usable match returned" };

  return {
    verdict: result.verdict,
    match,
    merged_content: result.merged_content || null,
    reason: result.reason,
    viaModel: true
  };

}


// The one call every capture path makes before writing.
//
// Returns { verdict, match, merged_content, reason }. Callers decide what to
// do with it — this deliberately performs no writes, so the same check can be
// used by a path that wants to merge and one that wants to skip.
export async function checkDuplicate({ table, content, kind = "note" }) {

  if (!content || !String(content).trim()) {
    return { verdict: "new" };
  }

  const candidates = await fetchCandidates(table);

  if (candidates.length === 0) return { verdict: "new" };


  // Free path first. An identical normalised form is a duplicate with no
  // judgment required, and it's what an accidental second run produces.
  const incoming = normalise(content);

  const exact = candidates.find(c => normalise(c.content) === incoming);

  if (exact) {
    return {
      verdict: "duplicate",
      match: exact,
      reason: "identical once normalised",
      viaModel: false
    };
  }


  // Only things plausibly related get sent to the model, and only the top few
  // — a 40-row prompt for every capture would be wasteful and would dilute
  // the comparison.
  const shortlist = candidates
    .map(c => ({ ...c, score: similarity(content, c.content) }))
    .filter(c => c.score >= SHORTLIST_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (shortlist.length === 0) return { verdict: "new" };


  let result;

  try {
    result = await classify({ content, candidates: shortlist, kind });
  } catch (error) {
    // Model unavailable: save it. A duplicate is recoverable, a dropped
    // capture is not.
    console.error("DEDUPE CLASSIFY FAILED:", error.message);
    return { verdict: "new", reason: "dedupe check unavailable" };
  }


  const match = Number.isInteger(result.match_index)
    ? shortlist[result.match_index]
    : null;

  // A verdict that points at nothing can't be acted on — treat it as new
  // rather than silently discarding the capture.
  if (result.verdict !== "new" && !match) {
    return { verdict: "new", reason: "no usable match returned" };
  }

  return {
    verdict: result.verdict,
    match,
    merged_content: result.merged_content || null,
    reason: result.reason,
    viaModel: true
  };

}


// Shared write-or-skip, since all three capture paths want the same behaviour
// and the differences are only in wording.
export async function saveDeduped({ table, content, kind, extraFields = {}, onUpdate = null }) {

  const check = await checkDuplicate({ table, content, kind });


  if (check.verdict === "duplicate") {

    return {
      success: true,
      duplicate: true,
      message: `Already had that one — "${check.match.content}"`,
      data: check.match
    };

  }


  if (check.verdict === "update" || check.verdict === "conflict") {

    const merged = check.merged_content || content;

    const { data, error } = await supabase
      .from(table)
      .update({ content: merged })
      .eq("id", check.match.id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Say what changed. An overwrite the user can't see is how the system
    // starts quietly holding a different version of their life than they do.
    if (onUpdate) await onUpdate(data);

    // The merged wording may name someone the original did not. Re-extracting
    // costs one upsert per hit and edges are keyed on the pair, so a name that
    // survived the merge simply re-confirms its existing edge.
    await linkText({ type: kind, id: data.id, text: merged });

    return {
      success: true,
      updated: true,
      conflicted: check.verdict === "conflict",
      message: check.verdict === "conflict"
        ? `Updated — that contradicted what I had ("${check.match.content}"). Kept the new version.`
        : `Updated what I had — was "${check.match.content}".`,
      data
    };

  }


  const { data, error } = await supabase
    .from(table)
    .insert([{ content, ...extraFields }])
    .select()
    .single();

  if (error) throw new Error(error.message);

  // `kind` is already the entity type this row is ("note", "intention",
  // "memory"), so notes and intentions both get their edges here without
  // either tool needing to know the graph exists.
  await linkText({ type: kind, id: data.id, text: content });

  return { success: true, data };

}
