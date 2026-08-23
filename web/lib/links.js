import supabase, { selectAll } from "./supabase.js";


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
  nudge:        { table: "nudges",          label: "message",  time: "created_at" },

  // Keyed by their normalised name rather than a uuid — see
  // docs/schema-merchants.sql. `extra` is the transaction count, which is what
  // makes a merchant node worth looking at: "Costco, 21 charges" is a fact,
  // "Costco" alone is a string that was already on the money page.
  merchant:     { table: "merchants",        label: "name",    time: "last_seen_at", extra: "txn_count" },
  category:     { table: "spend_categories", label: "name",    time: "updated_at",   extra: "txn_count" },

  // Everything below is a DATAPOINT rather than a thing with a name: a
  // weigh-in, a logged food, a morning brief, something the app noticed or
  // asked. None of them are produced by linkText (nothing writes an edge to a
  // number), so they appear on the graph as isolated dots via
  // isolatedNodes() — which is the point. The graph is meant to be the
  // living record of everything that passes through the app, and a record
  // that shows only what happens to be connected is a record with holes.
  weigh_in:     { table: "bodyweight_logs",   label: "weight",  time: "logged_at" },
  meal:         { table: "dining_log",        label: "meal",    time: "created_at", extra: "calories" },
  brief:        { table: "briefs",            label: "content", time: "created_at" },
  insight:      { table: "insights",          label: "title",   time: "created_at" },
  prompt:       { table: "prompts",           label: "title",   time: "created_at" },
  practice:     { table: "practice_sessions", label: "topic",   time: "created_at" }

};


export const LINKABLE = Object.keys(ENTITIES);


// table -> canonical type, inverted from the registry above rather than
// derived by chopping a trailing "s": "memories" chopped that way yields
// "memorie", which link() accepts (from_type is unconstrained text), no reader
// ever resolves, and pruneDangling never collects because it only prunes types
// it recognises — permanent orphan edges from one plausible-looking line.
export const TYPE_BY_TABLE = Object.fromEntries(
  Object.entries(ENTITIES).map(([type, spec]) => [spec.table, type])
);


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


// The same write, in bulk.
//
// link() is one round trip per edge, which was fine while the whole graph was
// 37 edges built from a few dozen name matches. Attaching every transaction to
// its merchant and its category is 258 edges on a database this size and grows
// with the bank feed — as individual upserts that is 258 sequential round trips
// inside a cron that also syncs transactions, rebuilds every text link and runs
// four detectors.
//
// Same natural key, same idempotence, so a batch and a single write are
// interchangeable and rebuildLinks can keep using whichever fits.
export async function linkMany(edges, { chunk = 500 } = {}) {

  const rows = (edges || [])
    .filter(e => e?.from?.type && e?.from?.id && e?.to?.type && e?.to?.id)
    // Self-edges, same rule as link().
    .filter(e => !(e.from.type === e.to.type && String(e.from.id) === String(e.to.id)))
    .map(e => ({
      from_type: e.from.type,
      from_id: String(e.from.id),
      to_type: e.to.type,
      to_id: String(e.to.id),
      relation: e.relation || "mentions",
      confidence: e.confidence ?? 1,
      source: e.source || "extracted",
      context: e.context ? String(e.context).slice(0, 280) : null
    }));

  if (rows.length === 0) return 0;

  // Postgres rejects an ON CONFLICT batch that contains the same key twice
  // ("cannot affect row a second time"), and a person can genuinely be charged
  // twice by one merchant in one import. Deduplicating here rather than relying
  // on the caller keeps that failure out of every future call site.
  const unique = new Map();

  for (const row of rows) {
    unique.set(`${row.from_type}|${row.from_id}|${row.to_type}|${row.to_id}|${row.relation}`, row);
  }

  const deduped = [...unique.values()];

  let written = 0;

  for (let i = 0; i < deduped.length; i += chunk) {

    const { error } = await supabase
      .from("entity_links")
      .upsert(deduped.slice(i, i + chunk), { onConflict: "from_type,from_id,to_type,to_id,relation" });

    if (error) {
      if (missing(error)) return written;
      console.error("LINK BATCH FAILED:", error.message);
      continue;
    }

    written += Math.min(chunk, deduped.length - i);

  }

  return written;

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


// Edges pointing at things that no longer exist.
//
// The polymorphic design traded referential integrity for the ability to link
// anything to anything (see docs/schema-islands.sql), and the accepted cost was
// that a deleted row leaves its edges behind. Every reader already tolerates
// that — walk() and graphAnchors() both drop a node whose row will not resolve.
//
// Tolerating is not the same as being correct. The live graph had a project
// whose anchor said 24 connections and whose page could only draw 23, because
// one deep thought had been deleted and its edge had not. Two different numbers
// for one thing, on a page whose entire claim is that it only states facts.
//
// So rebuildLinks — already the healer for edges that failed to be written —
// also becomes the healer for edges that should no longer exist. One query per
// entity type, one delete, nightly.
export async function pruneDangling() {

  // Pages, not a bare .limit(5000): the healer that skipped the oldest edges
  // past the 1,000-row cap would leave exactly the stale edges it exists to
  // remove, and report success. Ordered by id for a stable window.
  const { rows: data, error } = await selectAll(
    "entity_links",
    "id, from_type, from_id, to_type, to_id",
    { max: 5000, modify: q => q.order("id", { ascending: true }) }
  );

  if (error || !data) return 0;

  const refs = [];

  for (const edge of data) {
    refs.push({ type: edge.from_type, id: edge.from_id });
    refs.push({ type: edge.to_type, id: edge.to_id });
  }

  const alive = await hydrate(refs);

  const dead = data
    .filter(edge =>
      // An unknown TYPE is left alone deliberately. hydrate() skips types that
      // are not in the registry, so they would every one of them look dead —
      // and deleting the entire history of a type because it has not been
      // registered YET is a far worse failure than a stale edge.
      (ENTITIES[edge.from_type] && !alive.has(`${edge.from_type}:${edge.from_id}`)) ||
      (ENTITIES[edge.to_type] && !alive.has(`${edge.to_type}:${edge.to_id}`))
    )
    .map(edge => edge.id);

  if (dead.length === 0) return 0;

  const { error: deleteError } = await supabase.from("entity_links").delete().in("id", dead);

  if (deleteError) {
    console.error("PRUNE FAILED:", deleteError.message);
    return 0;
  }

  return dead.length;

}


// The whole graph, resolved and ready to draw.
//
// This exists for exactly one caller — the /graph page — and it is the one
// place in the system allowed to want everything at once. Every other reader
// stays bounded (walk, connectionsForText) because they ride inside reasoning
// calls; a page the user deliberately opened is the right place to spend one
// full read.
//
// The same postures as everywhere else in this file, applied at scale:
// dangling refs are dropped (a link both of whose ends resolve is a fact, a
// link to a deleted row is noise), hydration is one query per type, and the
// edge read is bounded — at 5,000 edges the answer is a slightly stale graph,
// not a timeout.
//
// It pages via selectAll(), NOT a bare .limit(): PostgREST caps any single
// response at 1,000 rows and .limit(5000) silently returns the first 1,000 in
// no defined order. The graph crossed 298 edges in one weekend and grows with
// the bank feed nightly, so a bare limit would quietly draw a partial,
// unstable graph — wrong dot sizes first, missing hubs next — on the one page
// whose entire promise is that it only shows facts. Ordered by id so the paged
// window is stable.
//
// `val` is the node's distinct-neighbour count, and it is what the page sizes
// dots by. Degree is the honest computed proxy for importance: it is derived
// from facts already in the database, needs no model, and cannot flatter.
// Recent rows of every entity type, whether or not anything links to them.
//
// entity_links only ever holds edges between things a sentence MENTIONED, so
// a graph built from edges alone can only show the part of a life that got
// talked about. Weigh-ins, meals, briefs, insights and prompts are never
// mentioned by anything — they are the raw record — so they had no way onto
// the page at all. Capped per type because this is a canvas, not a table: the
// most recent slice of each stream is a picture, 2,378 location points is a
// smear.
async function isolatedNodes({ perType = 40 } = {}) {

  const out = [];

  await Promise.all(Object.entries(ENTITIES).map(async ([type, spec]) => {

    const columns = ["id", spec.label, spec.time, spec.extra].filter(Boolean).join(", ");

    const { data, error } = await supabase
      .from(spec.table)
      .select(columns)
      .order(spec.time, { ascending: false })
      .limit(perType);

    if (error) {
      if (!missing(error)) console.error(`GRAPH ISOLATED ${type} FAILED:`, error.message);
      return;
    }

    for (const row of data || []) {
      out.push({
        key: `${type}:${row.id}`,
        type,
        label: row[spec.label],
        when: row[spec.time],
        ...(spec.extra ? { extra: row[spec.extra] } : {})
      });
    }

  }));

  return out;

}


export async function fullGraph({ limit = 5000 } = {}) {

  const { rows: data, error, capped } = await selectAll(
    "entity_links",
    "from_type, from_id, to_type, to_id, relation",
    { max: limit, modify: q => q.order("id", { ascending: true }) }
  );

  if (capped) {
    console.warn(`fullGraph hit its ${limit}-edge ceiling — the /graph page is showing a partial graph.`);
  }

  // A graph with no edges yet is still a graph of everything that has
  // happened — it just has no lines in it.
  const edges = (error ? [] : data) || [];

  const refs = [];

  for (const edge of edges) {
    refs.push({ type: edge.from_type, id: edge.from_id });
    refs.push({ type: edge.to_type, id: edge.to_id });
  }

  const [rows, isolated] = await Promise.all([hydrate(refs), isolatedNodes()]);

  // Labels are trimmed HERE, not in the client. An intention's label is a
  // whole sentence, and 180 of those in a payload that gets serialised into
  // the page HTML is real weight for information the canvas will never show.
  const short = (text) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > 70 ? `${clean.slice(0, 69)}…` : clean;
  };

  const neighbourSets = new Map();

  const links = [];

  for (const edge of edges) {

    const from = `${edge.from_type}:${edge.from_id}`;
    const to = `${edge.to_type}:${edge.to_id}`;

    // Both ends must resolve or the edge is not drawn — same dangling-edge
    // posture as walk(), applied to the pair.
    if (!rows.get(from)?.label || !rows.get(to)?.label) continue;

    links.push({ source: from, target: to, relation: edge.relation });

    if (!neighbourSets.has(from)) neighbourSets.set(from, new Set());
    if (!neighbourSets.has(to)) neighbourSets.set(to, new Set());

    neighbourSets.get(from).add(to);
    neighbourSets.get(to).add(from);

  }

  const nodes = [...neighbourSets.keys()].map(key => {

    const row = rows.get(key);

    return {
      id: key,
      type: row.type,
      label: short(row.label),
      when: row.when,
      ...(row.extra !== undefined && { extra: row.extra }),
      // Distinct neighbours, not edge count — two relations between the same
      // pair are one connection. The same lesson graphAnchors already learned.
      val: neighbourSets.get(key).size
    };

  });

  // Then everything that has no edges at all — the raw record. val 0 marks
  // them as isolated so the canvas can draw them smaller and dimmer rather
  // than pretending a weigh-in is a hub.
  const seen = new Set(nodes.map(n => n.id));

  for (const node of isolated) {

    if (seen.has(node.key)) continue;
    if (!node.label && node.label !== 0) continue;

    seen.add(node.key);

    nodes.push({
      id: node.key,
      type: node.type,
      label: short(node.label),
      when: node.when,
      ...(node.extra !== undefined && node.extra !== null && { extra: node.extra }),
      val: 0
    });

  }

  return { nodes, links };

}


// The things actually worth looking at, ranked by how connected they are.
//
// What a graph page opens on. Rendering "everything" was never an option here
// and would not have been useful if it were: the real shape is one project
// holding most of the edges, a handful of mid-sized hubs, and a long tail of
// leaves with exactly one connection each. A leaf has nothing to show — its
// neighbourhood is the single thing it is attached to — so the picker lists
// only nodes with more than one edge, and says so rather than rendering a page
// of dead ends.
//
// Degree is counted in code from one query rather than asked of the database
// per node. That is the same "compute in code" discipline the rest of the
// system runs on, and at this size it is also simply faster than the
// alternative.
export async function graphAnchors({ limit = 24, minDegree = 2 } = {}) {

  // Paged, not a bare .limit(5000): that silently reads only the first 1,000
  // edges (PostgREST's cap), so past that the ranking is computed over an
  // arbitrary unordered slice. selectAll keeps it whole. (This function has no
  // live caller since the radial view was replaced — kept because resolve/anchor
  // work may want it; a candidate for deletion, see the handoff.)
  const { rows: data, error } = await selectAll(
    "entity_links",
    "from_type, from_id, to_type, to_id",
    { max: 5000, modify: q => q.order("id", { ascending: true }) }
  );

  if (error || !data) return [];

  // Distinct NEIGHBOURS, not edges.
  //
  // Counting edges is the obvious version and it disagrees with the page. Two
  // things can be joined by more than one relation — a deep thought both
  // `mentions` a project and `belongs_to` it, which is two true edges about one
  // connection — and walk() collapses those into a single node because a
  // neighbourhood is a set of things, not a set of edges. Left as an edge count
  // the live project advertised 24 connections and then drew 23, which is one
  // number too many on a page whose whole claim is that it only states facts.
  const neighbourSets = new Map();

  const join = (key, other) => {
    if (!neighbourSets.has(key)) neighbourSets.set(key, new Set());
    neighbourSets.get(key).add(other);
  };

  for (const edge of data) {

    const from = `${edge.from_type}:${edge.from_id}`;
    const to = `${edge.to_type}:${edge.to_id}`;

    if (ENTITIES[edge.from_type]) join(from, to);
    if (ENTITIES[edge.to_type]) join(to, from);

  }

  const ranked = [...neighbourSets.entries()]
    .map(([key, set]) => [key, set.size])
    .filter(([, n]) => n >= minDegree)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => {
      const split = key.indexOf(":");
      return { type: key.slice(0, split), id: key.slice(split + 1), degree: n };
    });

  if (ranked.length === 0) return [];

  const rows = await hydrate(ranked);

  // Same dangling-edge posture as walk(): an anchor whose row has been deleted
  // is dropped rather than offered as a link to nothing.
  return ranked
    .map(anchor => {
      const row = rows.get(`${anchor.type}:${anchor.id}`);
      return row?.label ? { ...anchor, label: row.label, when: row.when, extra: row.extra } : null;
    })
    .filter(Boolean);

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
export async function resolveReference({ text, types = null, limit = 8, maxAnchors = 3 } = {}) {

  if (!text) return { anchors: [], candidates: [] };

  // Bounded like connectionsForText: one walk per anchor, so a sentence that
  // names six entities must not issue six walks. Strongest-confidence anchors
  // first, then cap. Without this a wordy capture is the easy way to make a
  // graph read expensive.
  const anchors = (await mentionsIn(text))
    .map(hit => ({
      type: hit.type,
      id: hit.id,
      name: hit.name,
      confidence: hit.confidence ?? 1
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxAnchors);

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

  const anchors = await mentionsIn(text);

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


// The identity of a merchant, from whatever the bank called it.
//
// Deterministic and pure, deliberately — no model call. A merchant key that
// depended on a model would drift between runs, and since this key is a PRIMARY
// KEY, drift means the same shop silently becoming two rows with the charges
// split between them. The bank's strings turned out to be clean enough that
// four rules cover every real collision in the data:
//
//   Anthropic.com / Anthropic          → a bare TLD is not part of a name
//   Salt & Straw  / Salt and Straw     → ampersand and "and" are one word
//   Uber Pending Transaction / Uber    → the bank's own status, not the payee
//   COSTCO / Costco                    → case is not identity
//
// What it deliberately does NOT collapse is "Costco" and "Costco Gas". Those
// are a supermarket and a filling station that happen to share an owner, they
// land in different categories, and merging them would make the grocery total
// wrong. Under-merging leaves two honest rows; over-merging invents a fact.
export function merchantKey(raw) {

  if (!raw) return null;

  const key = String(raw)
    .toLowerCase()
    .replace(/\s+pending transaction\b/g, "")
    .replace(/\.(com|net|org|io|co|inc)\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return key || null;

}


// A merchant seen once is a node; a merchant seen twice is a name.
//
// Only repeat merchants are matched against free text. The one-off list in the
// real data includes "Link.com", and putting the word "link" into the matcher
// would attach a payment to every note that mentions a link — precisely the
// confident wrongness this file opens by refusing. Singletons still exist as
// graph nodes and still carry their own transaction's edge; they just never
// claim to have been mentioned.
const MIN_TXNS_FOR_ROSTER = 2;


// Which kinds of thing may be recognised from the FIRST WORD of their name.
//
// This used to apply to everything, which was survivable while the roster held
// nine people, one project and two places, and became a live hazard the moment
// merchants joined it. "Sam" standing in for "Sam Smith" is how people write.
// "Quality" standing in for "Quality Food Centers" is not — it attaches a
// supermarket to any sentence containing the word quality, and the same rule
// hands "Department of Education" the word *department* and "Google Workspace"
// the word *google*.
//
// It was already wrong for places and nobody had noticed: the one real place on
// file is labelled "Temporary internship home", whose first word is
// *temporary*. Restricting the fallback to people and projects keeps the
// behaviour it was written for and removes the three cases it was never meant
// to cover. A project earns it because "Trifilm" genuinely is what someone
// calls "Trifilm Exit Conversion".
const PARTIAL_NAME_TYPES = new Set(["person", "project"]);


export function findMentions(text, entities, { partialNames = true } = {}) {

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

      if (!partialNames) continue;

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


// Every mention of any known entity in one pass, with the per-type rules
// applied. Four call sites were each looping over loadEntities() and calling
// findMentions themselves, which is how the first-word rule reached merchants:
// there was no single place that knew a merchant is not a person.
export async function mentionsIn(text) {

  if (!text) return [];

  const entities = await loadEntities();

  const hits = [];

  for (const [type, roster] of Object.entries(entities)) {
    for (const hit of findMentions(text, roster, { partialNames: PARTIAL_NAME_TYPES.has(type) })) {
      hits.push({ ...hit, type, id: String(hit.id) });
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

  const [people, projects, places, merchants] = await Promise.all([
    supabase.from("people").select("id, name").then(r => r.data || []),
    supabase.from("projects").select("id, name").then(r => r.data || []),
    supabase.from("places").select("id, label").then(r => (r.data || []).map(p => ({ id: p.id, name: p.label }))).catch(() => []),
    supabase
      .from("merchants")
      .select("id, name, txn_count")
      .gte("txn_count", MIN_TXNS_FOR_ROSTER)
      .then(r => r.data || [])
      // The table arrives in a migration that is pasted by hand, so until it is
      // run this is simply an empty roster — the same degradation every other
      // read in this file makes.
      .catch(() => [])
  ]);

  cachedEntities = {
    person: people,
    project: projects,
    // A place with no label yet is not a name anyone wrote, so it can never be
    // mentioned. Filtering here also keeps findMentions from matching on the
    // first word of a placeholder.
    place: (places || []).filter(p => p.name),
    merchant: merchants || []
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

    let created = 0;

    for (const hit of await mentionsIn(text)) {

      const made = await link({
        from: { type, id },
        to: { type: hit.type, id: hit.id },
        relation: "mentions",
        confidence: hit.confidence ?? 1,
        context: text
      });

      if (made) created++;

    }

    return created;

  } catch (error) {

    console.error("LINK ON CAPTURE FAILED:", error.message);

    return 0;

  }

}
