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


// ── What an entity type actually is ──────────────────────────────────────
//
// The edge table stores `from_type`/`from_id` as bare strings, which is what
// makes it polymorphic and is the right trade. The cost is that an edge on its
// own is unreadable: "memory 4f2c → person 91ab" is not a fact anyone can act
// on. This registry is what turns a stored edge back into a sentence, and it is
// the single place that knows where each kind of thing lives.
//
// Adding a type here is what makes it linkable, hydratable and walkable at
// once — previously LINKABLE was a hand-maintained array that had already
// drifted (`nudge` edges were being written by rebuildLinks while `nudge` was
// not in the list, so nothing downstream could resolve one).
//
//   table  — where the row lives
//   label  — the column a human would recognise it by
//   time   — the column that best answers "when was this"
//   extra  — optional second column worth showing (a charge without its amount
//            is not worth surfacing)
export const ENTITIES = {

  memory:       { table: "memories",        label: "content",  time: "created_at" },
  note:         { table: "notes",           label: "content",  time: "created_at" },
  intention:    { table: "intentions",      label: "content",  time: "created_at" },
  task:         { table: "tasks",           label: "title",    time: "created_at" },
  event:        { table: "calendar_events", label: "title",    time: "start_time" },
  project:      { table: "projects",        label: "name",     time: "updated_at" },
  person:       { table: "people",          label: "name",     time: "updated_at" },
  place:        { table: "places",          label: "label",    time: "last_seen_at" },
  transaction:  { table: "transactions",    label: "merchant", time: "posted_at", extra: "amount" },
  deep_thought: { table: "deep_thoughts",   label: "topic",    time: "created_at" },
  news_item:    { table: "news_items",      label: "headline", time: "surfaced_at" },
  nudge:        { table: "nudges",          label: "message",  time: "created_at" }

};


export const LINKABLE = Object.keys(ENTITIES);


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
// because "this memory mentions a contact" and "that contact is mentioned by this
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


// ── Reading the graph ────────────────────────────────────────────────────
//
// Everything above this line existed already, and everything above this line
// only ever wrote. `neighbours()` had exactly two callers, both inside one
// detector in tools/islands.js, and nothing else in the system could ask the
// graph a question — not the context assembly that feeds ten reasoning tools,
// not a query tool, not a page. The edges were real and unreadable.
//
// This is the read side. It is deliberately bounded in three ways, because a
// graph walk is the easiest place in this codebase to accidentally build
// something that costs real money on every request: depth is capped at 2, the
// node count is capped, and hydration is one query per TYPE rather than per
// node.


const MAX_DEPTH = 2;
const MAX_NODES = 60;


// Resolve a batch of {type, id} refs to rows, one query per type.
//
// The naive version is a query per node, which for a 40-node neighbourhood is
// 40 sequential round trips — the same N+1 shape that already makes
// detectFindings slow. Grouping by type turns it into at most one per type.
async function hydrate(refs) {

  const byType = new Map();

  for (const ref of refs) {
    if (!ENTITIES[ref.type]) continue;
    if (!byType.has(ref.type)) byType.set(ref.type, new Set());
    byType.get(ref.type).add(String(ref.id));
  }

  const resolved = new Map();

  await Promise.all([...byType.entries()].map(async ([type, ids]) => {

    const spec = ENTITIES[type];

    const columns = ["id", spec.label, spec.time, spec.extra].filter(Boolean).join(", ");

    const { data, error } = await supabase
      .from(spec.table)
      .select(columns)
      .in("id", [...ids]);

    // A type whose table is missing resolves to nothing rather than taking the
    // whole walk down — same posture as the rest of this file.
    if (error) {
      if (!missing(error)) console.error(`HYDRATE ${type} FAILED:`, error.message);
      return;
    }

    for (const row of data || []) {
      resolved.set(`${type}:${row.id}`, {
        type,
        id: String(row.id),
        label: row[spec.label] == null ? null : String(row[spec.label]),
        when: row[spec.time] || null,
        extra: spec.extra ? row[spec.extra] : undefined
      });
    }

  }));

  return resolved;

}


// Everything connected to one thing, resolved into readable rows.
//
// Returns nodes sorted by how strongly they are connected: distance first (a
// direct edge beats a second-hop one), then edge confidence, then recency. A
// dangling edge — one whose target row has since been deleted — is dropped
// rather than returned as a hole, which is the degradation the polymorphic
// design traded for (see the schema-islands.sql comment).
export async function walk({ type, id, depth = 1, relation = null, minConfidence = 0, limit = MAX_NODES } = {}) {

  if (!ENTITIES[type] || id == null) return { root: null, nodes: [] };

  const hops = Math.max(1, Math.min(depth, MAX_DEPTH));

  const seen = new Set([`${type}:${String(id)}`]);

  const found = new Map();

  let frontier = [{ type, id: String(id) }];

  for (let distance = 1; distance <= hops; distance++) {

    // One round of expansion, all frontier nodes in parallel.
    const rounds = await Promise.all(
      frontier.map(node => neighbours({ type: node.type, id: node.id, relation }))
    );

    const next = [];

    for (const edges of rounds) {

      for (const edge of edges) {

        if ((edge.confidence ?? 1) < minConfidence) continue;

        const key = `${edge.otherType}:${edge.otherId}`;

        if (seen.has(key)) continue;

        seen.add(key);

        found.set(key, {
          type: edge.otherType,
          id: String(edge.otherId),
          relation: edge.relation,
          direction: edge.direction,
          confidence: edge.confidence ?? 1,
          source: edge.source,
          context: edge.context,
          distance
        });

        next.push({ type: edge.otherType, id: String(edge.otherId) });

      }

    }

    if (next.length === 0) break;

    // The cap is applied per round rather than only at the end, so a
    // pathological hub cannot make the second hop enormous before it is
    // trimmed. Two hops off a well-connected person is where this would
    // otherwise get expensive.
    frontier = next.slice(0, limit);

    if (found.size >= limit) break;

  }

  const rows = await hydrate([...found.values()]);

  const nodes = [...found.values()]
    .map(node => {
      const row = rows.get(`${node.type}:${node.id}`);
      return row ? { ...node, label: row.label, when: row.when, extra: row.extra } : null;
    })
    .filter(node => node && node.label)
    .sort((a, b) =>
      a.distance - b.distance ||
      b.confidence - a.confidence ||
      String(b.when || "").localeCompare(String(a.when || ""))
    )
    .slice(0, limit);

  const rootRow = (await hydrate([{ type, id }])).get(`${type}:${String(id)}`) || null;

  return { root: rootRow, nodes };

}


// A neighbourhood as prose, for a prompt.
//
// Kept terse on purpose. This is destined for buildRichContext(), which rides
// in every reasoning call, so the whole point is a few dozen tokens that say
// what is connected to what — not a data dump. Anything wanting detail calls
// walk() directly.
export function describeNeighbourhood({ root, nodes }, { limit = 12 } = {}) {

  if (!root || !nodes?.length) return null;

  const short = (text) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > 70 ? `${clean.slice(0, 69)}…` : clean;
  };

  const lines = nodes.slice(0, limit).map(node => {

    const amount = node.type === "transaction" && node.extra != null
      ? ` ($${Math.abs(Number(node.extra)).toFixed(2)})`
      : "";

    const hop = node.distance > 1 ? " (indirect)" : "";

    return `- ${node.type}: ${short(node.label)}${amount}${hop}`;

  });

  return `Connected to "${short(root.label)}":\n${lines.join("\n")}`;

}


// ── Resolving a vague reference ──────────────────────────────────────────
//
// "The thing with Priya", when there are three things with Priya on file.
//
// tools/pending.js handles the one-shot case where the router asks a question
// and the very next utterance answers it. It cannot handle a reference to
// something from days ago, because that needs to know what is connected to
// whom — which is what the graph has always held and nothing has ever read.
//
// Deliberately returns ranked CANDIDATES rather than picking one. The rule
// this file opens with — never guess — applies here more than anywhere: an
// ambiguous reference resolved silently to the wrong thing is exactly the sort
// of confident wrongness that costs trust permanently. The caller decides
// whether the top candidate is clear enough to act on or whether to ask.
export async function resolveReference({ text, types = null, limit = 8 } = {}) {

  if (!text) return { anchors: [], candidates: [] };

  const entities = await loadEntities();

  const anchors = [];

  for (const [entityType, roster] of Object.entries(entities)) {
    for (const hit of findMentions(text, roster)) {
      anchors.push({ type: entityType, id: String(hit.id), name: hit.name, confidence: hit.confidence ?? 1 });
    }
  }

  if (anchors.length === 0) return { anchors: [], candidates: [] };

  const walks = await Promise.all(
    anchors.map(anchor => walk({ type: anchor.type, id: anchor.id, depth: 1 }))
  );

  const merged = new Map();

  walks.forEach((result, index) => {

    for (const node of result.nodes) {

      if (types && !types.includes(node.type)) continue;

      const key = `${node.type}:${node.id}`;

      const existing = merged.get(key);

      // A candidate connected to two anchors named in the same sentence is a
      // better match than one connected to either alone, so anchors accumulate
      // rather than overwrite.
      if (existing) {
        existing.via.push(anchors[index].name);
        existing.score += node.confidence * anchors[index].confidence;
        continue;
      }

      merged.set(key, {
        ...node,
        via: [anchors[index].name],
        score: node.confidence * anchors[index].confidence
      });

    }

  });

  const candidates = [...merged.values()]
    .sort((a, b) =>
      b.via.length - a.via.length ||
      b.score - a.score ||
      String(b.when || "").localeCompare(String(a.when || ""))
    )
    .slice(0, limit);

  return {
    anchors,
    candidates,
    // The honest answer to "is this clear enough to act on". One candidate, or
    // a leader connected to strictly more of the named anchors than anything
    // else, is unambiguous; anything else needs a question.
    unambiguous:
      candidates.length === 1 ||
      (candidates.length > 1 && candidates[0].via.length > candidates[1].via.length)
  };

}


// What the graph knows about whatever this text is about.
//
// The bridge between the graph and every reasoning call. buildRichContext()
// already retrieves memories by semantic similarity — things that are ABOUT
// the same subject. This adds the other axis: things that are CONNECTED to it.
// Asking "how is the Trifilm thing going" retrieves memories that mention it
// and now also its twelve open tasks, the two deep thoughts about it and what
// it has cost, none of which need to resemble the question to be relevant.
//
// ── Why this is nearly free ──────────────────────────────────────────────
//
// It costs nothing at all unless the text names something the system already
// knows. The roster is cached for a minute and the matching is a regex, so a
// question that names no person, project or place does one cached lookup and
// returns null before touching the database. That property is deliberate:
// this rides in every reasoning call, and most of them mention nobody.
//
// When something IS named, the work is bounded by construction — at most two
// anchors, one hop each, and walk() issues one query per entity type rather
// than one per node.
export async function connectionsForText({ text, maxAnchors = 2, perAnchor = 8 } = {}) {

  if (!text) return null;

  const entities = await loadEntities();

  const anchors = [];

  for (const [entityType, roster] of Object.entries(entities)) {
    for (const hit of findMentions(text, roster)) {
      anchors.push({ type: entityType, id: String(hit.id), name: hit.name });
    }
  }

  // The common case. No database work has happened.
  if (anchors.length === 0) return null;

  const walks = await Promise.all(
    anchors.slice(0, maxAnchors).map(anchor =>
      walk({ type: anchor.type, id: anchor.id, depth: 1, limit: perAnchor })
        .catch(() => null)
    )
  );

  const described = walks
    .filter(Boolean)
    .map(result => describeNeighbourhood(result, { limit: perAnchor }))
    .filter(Boolean);

  return described.length ? described.join("\n\n") : null;

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
      // "Sam" matching "Samuel" and "Art" matching "Cartwright".
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
//
// Cached briefly, because this is now read on the capture path as well as by
// the nightly rebuild. People and projects change a few times a week; holding
// the roster for a minute turns three queries per capture into three queries
// per minute, and a person saved seconds ago is linkable within one.
let cachedEntities = null;
let cachedEntitiesAt = 0;

const ENTITY_TTL_MS = 60 * 1000;


export function clearEntityCache() {
  cachedEntities = null;
  cachedEntitiesAt = 0;
}


export async function loadEntities() {

  if (cachedEntities && Date.now() - cachedEntitiesAt < ENTITY_TTL_MS) {
    return cachedEntities;
  }

  const [people, projects, places] = await Promise.all([
    supabase.from("people").select("id, name").then(r => r.data || []),
    supabase.from("projects").select("id, name").then(r => r.data || []),
    supabase.from("places").select("id, label").then(r => (r.data || []).map(p => ({ id: p.id, name: p.label }))).catch(() => [])
  ]);

  cachedEntities = {
    person: people,
    project: projects,
    // A place with no label yet is not a name anyone wrote, so it can never be
    // mentioned. Filtering here also keeps findMentions from matching on the
    // first word of a placeholder.
    place: (places || []).filter(p => p.name)
  };

  cachedEntitiesAt = Date.now();

  return cachedEntities;

}


// Link one freshly written row to everyone and everything it names.
//
// The graph used to be built exclusively by the nightly rebuildLinks pass, so
// a note written at 9am naming a person and a project was invisible to the
// graph until 6am the next day — which is precisely the window in which the
// connection is most useful. This closes that gap: the same extraction, run
// once at write time on one row instead of nightly on five hundred.
//
// rebuildLinks stays, and stays the source of truth. It is the healer: it
// catches rows written while this failed, rows written before a person existed
// to be matched against, and any type that does not call this. Because link()
// upserts on the natural key, the two cannot conflict — the nightly pass over
// a row this already handled is a no-op.
//
// Never throws. A capture that succeeded must not be reported as failed
// because an edge could not be written.
export async function linkText({ type, id, text }) {

  if (!type || !id || !text) return 0;

  try {

    const entities = await loadEntities();

    let created = 0;

    for (const [entityType, roster] of Object.entries(entities)) {

      for (const hit of findMentions(text, roster)) {

        const made = await link({
          from: { type, id },
          to: { type: entityType, id: hit.id },
          relation: "mentions",
          confidence: hit.confidence ?? 1,
          context: text
        });

        if (made) created++;

      }

    }

    return created;

  } catch (error) {

    console.error("LINK ON CAPTURE FAILED:", error.message);

    return 0;

  }

}
