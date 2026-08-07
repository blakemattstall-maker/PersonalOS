import supabase from "./supabase.js";


// The edge layer.
//
// Every domain here has been its own island: memories know nobody, money is a
// cached blob with no owner, places belong to no one, and nothing records that
// a charge, a person, a project and an evening were the same event. This is
// what joins them, and everything downstream — insights, briefs, deep thoughts
// — reads the graph rather than one table at a time.
//
// Two things it deliberately does NOT do.
//
// It does not guess. An edge is created from a name that actually appears in
// the text, matched against entities that actually exist, and never from a
// model's impression that two things feel related. A wrong edge is worse than a
// missing one, because everything downstream treats edges as fact.
//
// And it does not throw when the tables are absent. The migration is pasted by
// hand (docs/schema-islands.sql), so until it runs every function here degrades
// to "no links", which reads exactly like a system that has not noticed
// anything yet rather than a broken one.


export const LINKABLE = [
  "memory", "note", "intention", "task", "event",
  "project", "person", "place", "transaction", "deep_thought", "news_item"
];


function missing(error) {
  return error?.code === "PGRST205" || /schema cache|does not exist/i.test(error?.message || "");
}


export async function linksReady() {
  const { error } = await supabase.from("entity_links").select("id").limit(1);
  return !error;
}


// Upserts by the natural key, so re-running extraction over the same text is
// free rather than duplicative.
export async function link({ from, to, relation = "mentions", confidence = 1, source = "extracted", context = null }) {

  if (!from?.type || !from?.id || !to?.type || !to?.id) return null;

  // Self-edges are noise and both directions of the same pair would double the
  // graph without adding anything.
  if (from.type === to.type && String(from.id) === String(to.id)) return null;

  const row = {
    from_type: from.type,
    from_id: String(from.id),
    to_type: to.type,
    to_id: String(to.id),
    relation,
    confidence,
    source,
    context: context ? String(context).slice(0, 280) : null
  };

  const { data, error } = await supabase
    .from("entity_links")
    .upsert(row, { onConflict: "from_type,from_id,to_type,to_id,relation" })
    .select()
    .single();

  if (error) {
    if (missing(error)) return null;
    console.error("LINK FAILED:", error.message);
    return null;
  }

  return data;

}


// Everything touching one entity, in both directions. Direction is preserved
// because "this memory mentions Cooper" and "Cooper is mentioned by this
// memory" are the same edge but not the same sentence.
export async function neighbours({ type, id, relation = null }) {

  const base = supabase.from("entity_links").select("*");

  const [out, incoming] = await Promise.all([
    relation
      ? base.eq("from_type", type).eq("from_id", String(id)).eq("relation", relation)
      : supabase.from("entity_links").select("*").eq("from_type", type).eq("from_id", String(id)),
    relation
      ? supabase.from("entity_links").select("*").eq("to_type", type).eq("to_id", String(id)).eq("relation", relation)
      : supabase.from("entity_links").select("*").eq("to_type", type).eq("to_id", String(id))
  ]);

  if (out.error && missing(out.error)) return [];

  return [
    ...(out.data || []).map(e => ({ ...e, direction: "out", otherType: e.to_type, otherId: e.to_id })),
    ...(incoming.data || []).map(e => ({ ...e, direction: "in", otherType: e.from_type, otherId: e.from_id }))
  ];

}


// ── Recognising entities in text ─────────────────────────────────────────
//
// Name matching, with the obvious traps handled. "Jake" must not match inside
// "Jakeb", a first name alone is enough because that is how people write, and
// a two-letter name is ignored entirely — the false-positive rate on those
// swamps anything they find.

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


export function findMentions(text, entities) {

  if (!text) return [];

  const hits = [];

  for (const entity of entities) {

    const names = [entity.name, ...(entity.aliases || [])].filter(Boolean);

    for (const name of names) {

      const trimmed = String(name).trim();

      if (trimmed.length < 3) continue;

      // Whole word, case-insensitive. The \b on both sides is what stops
      // "Jake" matching "Jakeb" and "Cooper" matching "Cooperative".
      const pattern = new RegExp(`\\b${escape(trimmed)}\\b`, "i");

      if (pattern.test(text)) {
        hits.push({ id: entity.id, name: entity.name, matched: trimmed });
        break;
      }

      // First name on its own — how people actually refer to each other.
      const first = trimmed.split(/\s+/)[0];

      if (first.length >= 3 && first !== trimmed) {
        const firstPattern = new RegExp(`\\b${escape(first)}\\b`, "i");
        if (firstPattern.test(text)) {
          hits.push({ id: entity.id, name: entity.name, matched: first, confidence: 0.8 });
          break;
        }
      }

    }

  }

  return hits;

}


// The roster every extraction pass matches against: real people and real
// projects, loaded once rather than per row.
export async function loadEntities() {

  const [people, projects, places] = await Promise.all([
    supabase.from("people").select("id, name").then(r => r.data || []),
    supabase.from("projects").select("id, name").then(r => r.data || []),
    supabase.from("places").select("id, label").then(r => (r.data || []).map(p => ({ id: p.id, name: p.label }))).catch(() => [])
  ]);

  return {
    person: people,
    project: projects,
    place: (places || []).filter(p => p.name)
  };

}
