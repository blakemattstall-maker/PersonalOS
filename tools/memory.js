import supabase from "../lib/supabase.js";
import { embed } from "../lib/embeddings.js";
import { checkDuplicate } from "../lib/dedupe.js";


function missingColumnOrFunction(error) {
  // Undefined column (42703) or undefined function (42883) are Postgres's own
  // codes; PGRST202/PGRST204 are PostgREST's, raised from its own schema
  // cache before a query ever reaches Postgres — which is what actually fires
  // here, with a message shaped like "Could not find the 'embedding' column
  // of 'memories' in the schema cache", not the SQL-standard wording. Either
  // family means the retrieval migration (docs/schema-memory-retrieval.sql)
  // hasn't been run yet.
  return ["42703", "42883", "PGRST202", "PGRST204"].includes(error?.code)
    || /could not find.*column/i.test(error?.message || "")
    || /column .*embedding.* does not exist/i.test(error?.message || "")
    || /function match_memories/i.test(error?.message || "");
}


export async function saveMemory(
  type,
  content,
  importance = 5
) {

  // Capture is intentionally eager — a deep-thinking turn writes memories, the
  // router writes memories, and the same fact arrives through several doors.
  // Without this the result was four separate memories all saying "be blunt
  // with me", and a stored goal weight that disagreed with a stored intention.
  const check = await checkDuplicate({ table: "memories", content, kind: "memory" })
    .catch(() => ({ verdict: "new" }));

  if (check.verdict === "duplicate") {

    return {
      success: true,
      duplicate: true,
      message: `Already knew that — "${check.match.content}"`,
      data: check.match
    };

  }

  // Same subject, better information. Rewrite in place rather than keeping
  // both, and re-embed so retrieval matches the new wording rather than the
  // superseded one.
  if (check.verdict === "update" || check.verdict === "conflict") {

    const merged = check.merged_content || content;

    const newEmbedding = await embed(merged).catch(() => null);

    const patch = { content: merged, importance };

    if (newEmbedding) patch.embedding = newEmbedding;

    let { data, error } = await supabase
      .from("memories")
      .update(patch)
      .eq("id", check.match.id)
      .select()
      .single();

    if (error && newEmbedding && missingColumnOrFunction(error)) {
      ({ data, error } = await supabase
        .from("memories")
        .update({ content: merged, importance })
        .eq("id", check.match.id)
        .select()
        .single());
    }

    if (error) throw new Error(error.message);

    return {
      success: true,
      updated: true,
      conflicted: check.verdict === "conflict",
      message: check.verdict === "conflict"
        ? `Updated — that contradicted "${check.match.content}". Kept what you just said.`
        : `Updated — was "${check.match.content}".`,
      data
    };

  }

  // Best-effort — a missing/misconfigured embeddings call must never cost the
  // user their memory. Losing the semantic index for one row just means it
  // falls back to the importance-ranked list for that row, same as today.
  const embedding = await embed(content).catch(error => {
    console.error("MEMORY EMBEDDING FAILED:", error.message);
    return null;
  });

  const row = { type, content, importance };

  if (embedding) row.embedding = embedding;

  let { data, error } = await supabase
    .from("memories")
    .insert([row])
    .select()
    .single();

  // The embedding column doesn't exist yet on this database — retry without
  // it rather than losing the memory over a migration that hasn't landed.
  if (error && embedding && missingColumnOrFunction(error)) {

    ({ data, error } = await supabase
      .from("memories")
      .insert([{ type, content, importance }])
      .select()
      .single());

  }

  if (error) {
    throw new Error(error.message);
  }


  return {
    success: true,
    message: "Memory saved.",
    data
  };
}



export async function getMemories(
  limit = 10
) {

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .order("importance", {
      ascending: false
    })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  return data;
}



// Retrieval, with a hard fallback to the old behaviour at every failure point:
// no query, a missing embedding column, an OpenAI hiccup, or a network error
// all land on the same blanket top-N-by-importance list this replaced. That
// list is also genuinely correct (not just a fallback) when there's no single
// topic to be relevant to — the daily observer scans everything at once, so
// it deliberately never passes a query.
export async function getRelevantMemories({ query, limit = 12, alwaysTop = 4 } = {}) {

  if (!query) return getMemories(limit);

  const embedding = await embed(query).catch(() => null);

  if (!embedding) return getMemories(limit);

  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: embedding,
    match_count: limit
  });

  if (error || !data) {

    if (error && !missingColumnOrFunction(error)) {
      console.error("MEMORY RETRIEVAL FAILED:", error.message);
    }

    return getMemories(limit);

  }

  // Zero matches is not a valid retrieval result here, it's a symptom.
  // match_memories() filters `where embedding is not null`, so an un-backfilled
  // corpus returns [] for every query — and [] is truthy, so this used to sail
  // past the guard above and fall through to the blend below, quietly handing
  // every reasoning call only `alwaysTop` (4) memories instead of `limit` (12).
  // No error, no log, no way to notice. Treat an empty result as "retrieval
  // isn't working yet" and use the list that definitely does.
  if (data.length === 0) {

    console.warn(
      "MEMORY RETRIEVAL returned no matches — memories are likely not embedded yet. " +
      "Run backfillMemoryEmbeddings(). Falling back to top-N by importance."
    );

    return getMemories(limit);

  }

  // Blend in the handful of highest-importance memories even if they weren't
  // semantically close to this query — a standing fact ("allergic to X")
  // shouldn't disappear from every context just because today's question
  // doesn't happen to mention it.
  const important = await getMemories(alwaysTop).catch(() => []);

  const seen = new Set(data.map(m => m.id));
  const blended = [...data, ...important.filter(m => !seen.has(m.id))];

  return blended.slice(0, limit);

}


// One-off: existing rows saved before this migration have no embedding.
// Idempotent — only touches rows where embedding is still null, safe to
// re-run. Not wired to any endpoint; run it once from a local script after
// the SQL migration lands.
export async function backfillMemoryEmbeddings() {

  const { data: rows, error } = await supabase
    .from("memories")
    .select("id, content")
    .is("embedding", null);

  if (error) throw new Error(error.message);

  let updated = 0;
  const errors = [];

  for (const row of rows || []) {

    try {

      const embedding = await embed(row.content);

      if (!embedding) continue;

      const { error: updateError } = await supabase
        .from("memories")
        .update({ embedding })
        .eq("id", row.id);

      if (updateError) throw new Error(updateError.message);

      updated += 1;

    } catch (error) {
      errors.push({ id: row.id, error: error.message });
    }

  }

  return { success: true, total: rows?.length || 0, updated, errors };

}


export async function deleteMemory(id) {

  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function getFormattedMemories({ query, limit = 20 } = {}) {

  const memories = await getRelevantMemories({ query, limit });


  const grouped = {};


  memories.forEach(memory => {

    if (!grouped[memory.type]) {
      grouped[memory.type] = [];
    }


    grouped[memory.type].push({
      content: memory.content,
      importance: memory.importance
    });

  });


  return grouped;

}