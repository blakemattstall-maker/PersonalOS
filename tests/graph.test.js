import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ENTITIES, LINKABLE, describeNeighbourhood, findMentions, merchantKey } from "../web/lib/links.js";
import { groupIntoVisits, looksLikeGym } from "../web/tools/location.js";
import { layout, VIEW, CENTRE, LABEL_MARGIN } from "../web/app/graph/geometry.js";
import { nodeToRoot, rootToNode, detail, RELATION_LABEL } from "../web/app/graph/phrasing.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const islandsSource = read("web/tools/islands.js");
const linksSource = read("web/lib/links.js");
const dedupeSource = read("web/lib/dedupe.js");
const locationSource = read("web/tools/location.js");
const viewSource = read("web/app/graph/GraphView.js");


// A neighbourhood of the given shape: { task: 12, transaction: 8, ... }.
function neighbourhood(counts) {
  return Object.entries(counts).flatMap(([type, n]) =>
    Array.from({ length: n }, (_, i) => ({
      type,
      id: `${type}-${i}`,
      label: `${type} ${i}`,
      distance: 1,
      confidence: 1
    }))
  );
}


// ---------------------------------------------------------------------------
// An edge has to be readable, which means every type it names must be known.
// ---------------------------------------------------------------------------

test("every entity type the graph writes can also be resolved back to a row", () => {

  // LINKABLE was a hand-maintained array and had already drifted: rebuildLinks
  // writes `nudge -[belongs_to]-> intention` edges while `nudge` was not in the
  // list, so nothing downstream could turn one back into a sentence. Deriving
  // the list from the registry is what stops that recurring — but only if the
  // registry actually covers what the extractor writes.
  const written = new Set();

  // The `from`/`to` types named in tools/islands.js's structural edge table.
  for (const [, type, , targetType] of [...islandsSource.matchAll(
    /\["(\w+)",\s*"(\w+)",\s*"(\w+)",\s*"(\w+)"\]/g
  )].map(m => m.slice(1))) {
    written.add(type);
    written.add(targetType);
  }

  // The text sources at the top of the same file.
  for (const m of islandsSource.matchAll(/\{\s*type:\s*"(\w+)",\s*table:/g)) {
    written.add(m[1]);
  }

  for (const type of written) {
    assert.ok(
      ENTITIES[type],
      `tools/islands.js writes "${type}" edges, but lib/links.js's ENTITIES has no entry ` +
      "for it — those edges can be stored and never read back"
    );
  }

});


test("every registry entry names a table, a label and a time column", () => {

  for (const [type, spec] of Object.entries(ENTITIES)) {
    assert.ok(spec.table, `${type} has no table`);
    assert.ok(spec.label, `${type} has no label column — a node with no label is dropped from every walk`);
    assert.ok(spec.time, `${type} has no time column — ranking by recency would be undefined`);
  }

  assert.deepEqual(LINKABLE, Object.keys(ENTITIES), "LINKABLE must be derived from the registry, not maintained beside it");

});


// ---------------------------------------------------------------------------
// The walk output is destined for a prompt, so it has to stay small.
// ---------------------------------------------------------------------------

test("a neighbourhood description is bounded and never renders an empty one", () => {

  assert.equal(describeNeighbourhood({ root: null, nodes: [] }), null);
  assert.equal(describeNeighbourhood({ root: { label: "X" }, nodes: [] }), null);

  const nodes = Array.from({ length: 40 }, (_, i) => ({
    type: "task",
    id: String(i),
    label: `A task with a fairly long name that should get truncated somewhere ${i}`,
    distance: 1
  }));

  const text = describeNeighbourhood({ root: { label: "Project" }, nodes }, { limit: 5 });

  assert.equal(text.split("\n").length, 6, "one header line plus exactly `limit` nodes");

  assert.ok(
    text.split("\n").slice(1).every(line => line.length <= 90),
    "this rides in every reasoning call — an untruncated label would grow every prompt"
  );

});


test("an indirect connection is marked as one", () => {

  const text = describeNeighbourhood({
    root: { label: "Project" },
    nodes: [
      { type: "person", id: "1", label: "Direct", distance: 1 },
      { type: "person", id: "2", label: "Second hop", distance: 2 }
    ]
  });

  assert.match(text, /Direct$/m, "a direct edge carries no qualifier");
  assert.match(text, /Second hop \(indirect\)/, "a second-hop connection must not read as a stated fact");

});


test("a transaction is never described without its amount", () => {

  const text = describeNeighbourhood({
    root: { label: "Project" },
    nodes: [{ type: "transaction", id: "1", label: "Costco", extra: -245.13, distance: 1 }]
  });

  assert.match(text, /\$245\.13/, "a charge with no figure is not worth surfacing");

});


// ---------------------------------------------------------------------------
// Name matching, which decides what gets linked at all.
// ---------------------------------------------------------------------------

test("a name matches on a word boundary and never inside a longer word", () => {

  const roster = [{ id: "1", name: "Sam Whitfield" }, { id: "2", name: "Art Chen" }];

  assert.equal(findMentions("spoke to Sam today", roster).length, 1);
  assert.equal(findMentions("Samuel called", roster).length, 0, "'Sam' must not match inside 'Samuel'");
  assert.equal(findMentions("drove past Cartwright Road", roster).length, 0, "'Art' must not match inside 'Cartwright'");

  assert.equal(
    findMentions("met Sam Whitfield", roster)[0].confidence ?? 1,
    1,
    "a full-name match is stated, not inferred"
  );

  assert.equal(
    findMentions("met Sam", roster)[0].confidence,
    0.8,
    "a first-name-only match is weaker and must say so"
  );

});


// ---------------------------------------------------------------------------
// Visits — the unit that makes location mean anything.
// ---------------------------------------------------------------------------

const at = (iso, place = "p1") => ({ recorded_at: iso, place_id: place });


test("a continuous run of points is one visit, not many", () => {

  const visits = groupIntoVisits([
    at("2026-08-05T19:00:00Z"),
    at("2026-08-05T19:15:00Z"),
    at("2026-08-05T20:00:00Z"),
    at("2026-08-05T21:30:00Z")
  ], { tz: "UTC" });

  assert.equal(visits.length, 1);
  assert.equal(visits[0].minutes, 150);

});


test("a gap long enough to be a real absence splits the visit", () => {

  // REVISIT_GAP_HOURS is 3 — the same threshold the ingest path uses to decide
  // whether returning counts as a new visit, so "a visit" means one thing.
  const visits = groupIntoVisits([
    at("2026-08-05T08:00:00Z"),
    at("2026-08-05T09:00:00Z"),
    at("2026-08-05T14:00:00Z"),
    at("2026-08-05T15:00:00Z")
  ], { tz: "UTC" });

  assert.equal(visits.length, 2);
  assert.deepEqual(visits.map(v => v.minutes).sort(), [60, 60]);

});


test("points arriving out of order do not invent a negative stay", () => {

  const visits = groupIntoVisits([
    at("2026-08-05T21:00:00Z"),
    at("2026-08-05T19:00:00Z"),
    at("2026-08-05T20:00:00Z")
  ], { tz: "UTC" });

  assert.equal(visits.length, 1);
  assert.equal(visits[0].minutes, 120);

});


test("a lone point is a sighting with no invented duration", () => {

  const visits = groupIntoVisits([at("2026-08-05T19:00:00Z")], { tz: "UTC" });

  assert.equal(visits.length, 1);
  assert.equal(visits[0].minutes, 0, "one point proves presence, not a stay");

});


test("an overnight stay belongs to the day it started, in the user's zone", () => {

  // The longest visit on real data runs 19:36 to 15:37 the next afternoon.
  // Splitting it at midnight would report two half-visits and double the
  // "places visited" count for both days.
  const visits = groupIntoVisits([
    at("2026-08-05T23:30:00-05:00"),
    at("2026-08-06T01:00:00-05:00"),
    at("2026-08-06T03:00:00-05:00"),
    at("2026-08-06T05:30:00-05:00"),
    at("2026-08-06T07:00:00-05:00")
  ], { tz: "America/Chicago" });

  assert.equal(visits.length, 1, "consecutive gaps are all under the 3h threshold");
  assert.equal(visits[0].day, "2026-08-05");
  assert.equal(visits[0].minutes, 450, "the whole stay, not the part before midnight");

});


test("visits at different places never merge", () => {

  const visits = groupIntoVisits([
    at("2026-08-05T19:00:00Z", "home"),
    at("2026-08-05T19:10:00Z", "work"),
    at("2026-08-05T19:20:00Z", "home")
  ], { tz: "UTC" });

  assert.equal(visits.length, 2);
  assert.deepEqual([...new Set(visits.map(v => v.placeId))].sort(), ["home", "work"]);

});


test("a gym is only a gym because the user said so", () => {

  // There is no way to tell a gym from a coordinate. Guessing one would put a
  // fabricated number into daily_metrics, which is the longitudinal record.
  assert.ok(looksLikeGym({ label: "Planet Fitness on Oak" }));
  assert.ok(looksLikeGym({ label: null, category: "gym" }));
  assert.ok(!looksLikeGym({ label: "Temporary internship home" }));
  assert.ok(!looksLikeGym({}));
  assert.ok(!looksLikeGym(null));

});


// ---------------------------------------------------------------------------
// The graph is now written on the capture path too.
// ---------------------------------------------------------------------------

test("every capture path links what it just wrote", () => {

  assert.match(
    dedupeSource,
    /linkText\(\{\s*type:\s*kind/,
    "saveDeduped covers notes and intentions — `kind` is already the entity type"
  );

  assert.match(
    read("web/tools/memory.js"),
    /linkText\(\{\s*type:\s*"memory"/,
    "saveMemory writes its own row rather than going through saveDeduped, so it needs its own call"
  );

  for (const type of ["task", "event"]) {
    assert.match(
      read("web/tools/database.js"),
      new RegExp(`linkText\\(\\{ type: "${type}"`),
      `${type} rows must be linked when created, not only by the nightly rebuild`
    );
  }

});


test("linking on capture can never fail a capture", () => {

  // A note that was saved must never be reported as failed because an edge
  // could not be written. linkText owns that guarantee for every call site.
  const body = linksSource.slice(linksSource.indexOf("export async function linkText"));

  assert.match(body.slice(0, 1200), /try\s*\{/, "linkText must wrap its work");
  assert.match(body.slice(0, 1600), /catch\s*\(error\)/, "and swallow the failure after logging it");

});


// ---------------------------------------------------------------------------
// PostgREST's silent 1000-row cap.
// ---------------------------------------------------------------------------

test("nothing scans a table with a limit PostgREST will silently ignore", () => {

  // `.limit(5000)` does not raise PostgREST's 1000-row response cap — it reads
  // as an intention to fetch everything and returns the first thousand with no
  // error. visitsInWindow shipped with exactly that bug and reported three
  // visits across a fortnight because it had only ever seen one day of points.
  for (const [name, source] of [
    ["tools/islands.js", islandsSource],
    ["tools/location.js", locationSource]
  ]) {

    for (const match of source.matchAll(/\.limit\((\d+)\)/g)) {

      assert.ok(
        Number(match[1]) <= 1000,
        `${name} calls .limit(${match[1]}), above PostgREST's 1000-row cap — it will be ` +
        "silently truncated. Use selectAll() from lib/supabase.js instead."
      );

    }

  }

});


// ---------------------------------------------------------------------------
// Merchant identity. This key is a PRIMARY KEY, so a wrong answer here splits
// one shop into two rows and divides its charges between them.
// ---------------------------------------------------------------------------

test("the spellings that are the same merchant collapse", () => {

  assert.equal(merchantKey("Anthropic.com"), merchantKey("Anthropic"));
  assert.equal(merchantKey("Salt & Straw"), merchantKey("Salt and Straw"));
  assert.equal(merchantKey("Uber Pending Transaction"), merchantKey("Uber"));
  assert.equal(merchantKey("COSTCO"), merchantKey("Costco"));

});


test("the ones that only look the same do not", () => {

  // A supermarket and a filling station that share an owner. They land in
  // different categories, and merging them makes the grocery total wrong.
  assert.notEqual(merchantKey("Costco"), merchantKey("Costco Gas"));

  // Different services behind one brand.
  assert.notEqual(merchantKey("Uber"), merchantKey("Uber Eats"));

  // Different payees.
  assert.notEqual(
    merchantKey("Zelle Transfer To Uncle Ray"),
    merchantKey("Zelle Transfer To Aunt Rosa")
  );

});


test("merchant keys are deterministic and need no model", () => {

  // The whole reason normalisation is a pure function: a key that drifted
  // between runs would silently fork a merchant's history in a primary key.
  for (const raw of ["Quality Food Centers", "Salt & Straw", "Anthropic.com", "Google One"]) {
    assert.equal(merchantKey(raw), merchantKey(raw));
  }

  assert.equal(merchantKey(null), null);
  assert.equal(merchantKey("   "), null);
  assert.equal(merchantKey("!!!"), null);

});


// ---------------------------------------------------------------------------
// The rule that keeps a bigger roster from producing worse edges.
// ---------------------------------------------------------------------------

test("a business is not recognised by the first word of its name", () => {

  // The fallback exists so "Sam" finds "Sam Smith". Applied to a merchant it
  // hands "Quality Food Centers" the word *quality*, "Department of Education"
  // the word *department*, and "Google Workspace" the word *google* — an edge
  // to a supermarket on any sentence praising something's quality.
  const merchants = [
    { id: "quality food centers", name: "Quality Food Centers" },
    { id: "department of education", name: "Department of Education" }
  ];

  assert.deepEqual(
    findMentions("the quality of this work is poor", merchants, { partialNames: false }),
    []
  );

  // The full name still matches.
  assert.equal(
    findMentions("picked it up at Quality Food Centers", merchants, { partialNames: false }).length,
    1
  );

});


test("only people and projects may be matched on a leading word", () => {

  // Places were always in the fallback's blast radius and nobody had noticed:
  // the real place on file is "Temporary internship home", whose first word is
  // *temporary*.
  const match = linksSource.match(/const PARTIAL_NAME_TYPES = new Set\(\[([^\]]*)\]\)/);

  assert.ok(match, "PARTIAL_NAME_TYPES must exist");

  const types = match[1].match(/"([a-z_]+)"/g).map(s => s.replace(/"/g, ""));

  assert.deepEqual(types.sort(), ["person", "project"]);

});


test("every matcher call site goes through the shared rules", () => {

  // Four call sites each looped over loadEntities() and called findMentions
  // themselves, which is exactly how the first-word rule reached merchants —
  // there was no single place that knew a merchant is not a person. A new one
  // that rebuilds the loop by hand reintroduces it.
  const callers = [
    ["web/lib/links.js", "resolveReference"],
    ["web/lib/links.js", "connectionsForText"],
    ["web/lib/links.js", "linkText"]
  ];

  for (const [file, fn] of callers) {
    const source = read(file);
    const body = source.slice(source.indexOf(`export async function ${fn}`));
    const scoped = body.slice(0, body.indexOf("\n}\n") + 1);
    assert.match(scoped, /mentionsIn\(/, `${fn} must use mentionsIn, not its own loop`);
  }

  assert.doesNotMatch(
    islandsSource,
    /Object\.entries\(entities\)/,
    "rebuildLinks must not iterate the roster itself either"
  );

});


test("a one-off merchant never enters the text matcher", () => {

  // The real data has a single charge at "Link.com". Normalised that is the
  // word "link", and every note mentioning a link would gain an edge to a
  // payment. Singletons stay graph nodes; they just cannot be "mentioned".
  assert.match(
    linksSource,
    /MIN_TXNS_FOR_ROSTER\s*=\s*2/,
    "the roster floor must exist"
  );

  const loader = linksSource.slice(linksSource.indexOf("export async function loadEntities"));

  assert.match(
    loader.slice(0, 1400),
    /\.gte\("txn_count", MIN_TXNS_FOR_ROSTER\)/,
    "and it must be applied in the query, not after"
  );

});


// ---------------------------------------------------------------------------
// Promotion writes facts, not judgements.
// ---------------------------------------------------------------------------

test("money entities are rebuilt from transactions, never maintained separately", () => {

  // The one failure this system has already produced twice is a second
  // summariser that keeps its own totals and drifts from the first. A merchant
  // whose txn_count is incremented rather than recomputed is that bug again.
  const body = islandsSource.slice(
    islandsSource.indexOf("async function promoteMoneyEntities"),
    islandsSource.indexOf("export async function rebuildLinks")
  );

  assert.match(body, /scanTable\("transactions"/, "it must read the transactions");
  assert.doesNotMatch(body, /\.rpc\(/, "and derive, not ask the database to increment");

});


test("promotion runs before the text scan, or merchants link a day late", () => {

  const promote = islandsSource.indexOf("const promoted = await promoteMoneyEntities()");
  const textScan = islandsSource.indexOf("for (const source of TEXT_SOURCES)");

  assert.ok(promote > 0 && textScan > 0, "both steps must exist");
  assert.ok(promote < textScan, "merchants must exist before text is matched against them");

});


test("the roster cache is cleared once the new rows exist", () => {

  // loadEntities() caches for a minute and was called before promotion wrote
  // anything. Without an explicit clear, the text scan immediately after would
  // match against the OLD roster and every merchant edge would wait for the
  // next nightly pass — a bug that looks exactly like "it just takes a day".
  const body = islandsSource.slice(
    islandsSource.indexOf("async function promoteMoneyEntities"),
    islandsSource.indexOf("export async function rebuildLinks")
  );

  const upsert = body.indexOf('.upsert([...merchants.values()]');
  const clear = body.indexOf("clearEntityCache()");

  assert.ok(clear > 0, "the cache must be cleared");
  assert.ok(clear > upsert, "and only after the rows are written");

});


test("a charge is not linked to its own merchant twice under two relations", () => {

  // lastIndexOf, not indexOf: promoteMoneyEntities scans the same table with a
  // line that shares this prefix, and anchoring on the first match silently
  // measured the wrong function.
  const body = islandsSource.slice(
    islandsSource.lastIndexOf('const txns = await scanTable("transactions"')
  );

  assert.match(
    body.slice(0, 1200),
    /hit\.type !== "merchant"/,
    "the mention pass must skip merchants — paid_to already states that fact"
  );

});


test("the anchor count is what the page will actually draw", () => {

  // Two things can be joined by more than one relation — a deep thought both
  // `mentions` a project and `belongs_to` it — and walk() collapses those into
  // one node because a neighbourhood is a set of things, not of edges. Counting
  // edges here made the live project advertise 24 connections and then draw 23.
  const body = linksSource.slice(
    linksSource.indexOf("export async function graphAnchors"),
    linksSource.indexOf("// A neighbourhood as prose")
  );

  assert.match(body, /new Set\(\)/, "neighbours must be collected as a set");
  assert.match(body, /set\.size/, "and the count must be the set's size, not an edge tally");
  assert.doesNotMatch(body, /degree\.set\(key, \(degree\.get\(key\) \|\| 0\) \+ 1\)/, "an edge tally is the bug");

});


test("pruning runs last, after everything that writes", () => {

  // Pruning before the rebuild would delete edges this pass is about to
  // recreate — churn, and a window where the graph is emptier than the data.
  const body = islandsSource.slice(islandsSource.indexOf("export async function rebuildLinks"));

  const promote = body.indexOf("promoteMoneyEntities()");
  const prune = body.indexOf("pruneDangling()");

  assert.ok(prune > 0, "rebuildLinks must prune");
  assert.ok(prune > promote, "and it must come after the writes");

});


test("an unregistered entity type is never pruned", () => {

  // hydrate() skips types it does not know, so every edge of a type not yet in
  // ENTITIES would look dead. Deleting a type's entire history because it has
  // not been registered YET is far worse than leaving a stale edge — and this
  // is precisely how `nudge` edges behaved once already, written by
  // rebuildLinks while absent from the linkable list.
  const body = linksSource.slice(
    linksSource.indexOf("export async function pruneDangling"),
    linksSource.indexOf("// The things actually worth looking at")
  );

  assert.match(body, /ENTITIES\[edge\.from_type\] &&/, "an unknown from_type must be left alone");
  assert.match(body, /ENTITIES\[edge\.to_type\] &&/, "and so must an unknown to_type");

});


test("a batch upsert cannot be killed by one duplicate pair", () => {

  // Postgres rejects an ON CONFLICT batch containing the same key twice
  // ("cannot affect row a second time"), and one merchant charging twice in a
  // single import produces exactly that. Whole batch fails, no edges written.
  const body = linksSource.slice(
    linksSource.indexOf("export async function linkMany"),
    linksSource.indexOf("// Everything touching one entity")
  );

  assert.match(body, /const unique = new Map\(\)/, "the batch must be deduplicated before it is sent");
  assert.match(body, /relation\}`/, "and the dedup key must be the full natural key");

});


// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

test("the graph endpoint is read-only", () => {

  const handler = read("web/app/api/[resource]/handler.js");

  const body = handler.slice(
    handler.indexOf("async function graph(req, res)"),
    handler.indexOf("const RESOURCES =")
  );

  assert.match(body, /req\.method !== "GET"/, "it must reject anything but GET");

  for (const write of ["upsert", "insert", "update", "delete", "link("]) {
    assert.ok(!body.includes(write), `the graph endpoint must never ${write} — looking is not recording`);
  }

});


test("the page never walks two hops by default", () => {

  const handler = read("web/app/api/[resource]/handler.js");

  const body = handler.slice(
    handler.indexOf("async function graph(req, res)"),
    handler.indexOf("const RESOURCES =")
  );

  // Depth 2 off the node holding most of the graph is most of the graph, which
  // is the hairball the whole focus-and-neighbourhood design exists to avoid.
  assert.match(body, /req\.query\.depth === "2" \? 2 : 1/);

});


test("an unknown entity type is refused rather than walked", () => {

  const handler = read("web/app/api/[resource]/handler.js");

  const body = handler.slice(
    handler.indexOf("async function graph(req, res)"),
    handler.indexOf("const RESOURCES =")
  );

  assert.match(body, /!ENTITIES\[type\]/, "the type must be checked against the registry");

});


test("every coordinate is rounded before it becomes an attribute", () => {

  // Trap #12d. Math.cos and Math.sin are not required to be correctly rounded,
  // so Node and the browser disagree in the last bits and every node in the
  // diagram hydrates as a mismatch. Both /welcome scenes already guard this.
  for (const node of layout(neighbourhood({ task: 12, transaction: 8 })).placed) {
    assert.equal(node.x, Number(node.x.toFixed(2)), `${node.x} carries more precision than the viewBox can express`);
    assert.equal(node.y, Number(node.y.toFixed(2)));
  }

});


// ---------------------------------------------------------------------------
// The geometry, checked directly rather than eyeballed.
//
// The real neighbourhood this was designed against: the project holding 65% of
// the graph, with 12 tasks, 8 charges, 3 deep thoughts and 1 intention.
// ---------------------------------------------------------------------------

test("nothing is drawn outside the frame", () => {

  const { placed, sectors } = layout(neighbourhood({ task: 12, transaction: 8, deep_thought: 3, intention: 1 }));

  for (const node of placed) {
    assert.ok(node.x > 0 && node.x < VIEW, `a dot at x=${node.x} is off the canvas`);
    assert.ok(node.y > 0 && node.y < VIEW, `a dot at y=${node.y} is off the canvas`);
  }

  // Labels sit further out than any dot and are the thing most likely to
  // overflow — and checking only the anchor point is what let the first render
  // ship "2 deep thoughts" as "eep thoughts". A centred label needs half its
  // own width of clearance on each side, not zero.
  for (const shape of [
    { task: 12, transaction: 8, deep_thought: 3, intention: 1 },
    { deep_thought: 4, transaction: 3 },
    { transaction: 20, merchant: 9, category: 4, note: 3, person: 2 }
  ]) {

    for (const sector of layout(neighbourhood(shape)).sectors) {
      assert.ok(
        sector.labelX - LABEL_MARGIN >= 0 && sector.labelX + LABEL_MARGIN <= VIEW,
        `the ${sector.type} label at x=${sector.labelX} will be cut off by the frame`
      );
      assert.ok(sector.labelY > 0 && sector.labelY < VIEW);
    }

  }

});


test("two dots never land on top of each other", () => {

  // The failure this design is most exposed to: a crowded sector packing twelve
  // dots into a narrow arc. The two-ring alternation exists for exactly this,
  // and "it looked fine" is not a measurement.
  const { placed } = layout(neighbourhood({ task: 12, transaction: 8, deep_thought: 3, intention: 1 }));

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const gap = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
      // Dots are drawn at r=4.6, so anything under ~10 units reads as one blob.
      assert.ok(gap > 10, `two dots are ${gap.toFixed(1)} units apart — they will read as one`);
    }
  }

});


test("a node two hops out is always drawn further than any node one hop out", () => {

  // Otherwise "further away" and "there were a lot of these" look identical on
  // screen, and only one of them is a fact about the data.
  const { placed } = layout([
    ...Array.from({ length: 12 }, (_, i) => ({ type: "task", id: `t${i}`, label: `T${i}`, distance: 1 })),
    { type: "note", id: "n1", label: "N", distance: 2 }
  ]);

  const near = placed.filter(n => n.distance === 1);
  const far = placed.find(n => n.distance === 2);

  const radius = (n) => Math.hypot(n.x - CENTRE, n.y - CENTRE);

  for (const node of near) {
    assert.ok(
      radius(far) > radius(node) - 0.01,
      "a second-hop node is drawn closer in than a first-hop one"
    );
  }

});


test("one type fills the circle instead of leaving it three-quarters empty", () => {

  const { sectors, placed } = layout(neighbourhood({ transaction: 6 }));

  assert.equal(sectors.length, 1);
  assert.equal(placed.length, 6);

  // A single group should span nearly the whole circle, not a token wedge.
  const angles = placed.map(n => Math.atan2(n.y - CENTRE, n.x - CENTRE));
  const spread = Math.max(...angles) - Math.min(...angles);

  assert.ok(spread > Math.PI, `six charges spanned only ${spread.toFixed(2)} radians`);

});


test("a lone neighbour is centred in its own sector rather than at its edge", () => {

  const { placed } = layout([{ type: "person", id: "p1", label: "P", distance: 1 }]);

  assert.equal(placed.length, 1);

  // Not asserting where, only that it was placed and rounded — a divide by
  // (members.length - 1) with one member is the classic NaN here.
  assert.ok(Number.isFinite(placed[0].x) && Number.isFinite(placed[0].y));

});


test("an empty neighbourhood lays out as nothing rather than throwing", () => {

  assert.deepEqual(layout([]), { placed: [], sectors: [] });
  assert.deepEqual(layout(null), { placed: [], sectors: [] });

});


test("the space between groups is always wider than the space within one", () => {

  // The property the whole diagram rests on, and the one the first version got
  // backwards. With 23 nodes and a fixed 0.16 rad separator, the gap BETWEEN
  // groups was smaller than the 0.27 rad spacing inside the task group — so the
  // ring rendered as one unbroken circle and the diagram's only claim, that
  // these came from different tables, was silently not being made.
  for (const shape of [
    { task: 12, transaction: 8, deep_thought: 2, intention: 1 },
    { task: 3, person: 2 },
    { transaction: 30, merchant: 12, category: 5, note: 2 }
  ]) {

    const { placed } = layout(neighbourhood(shape));

    const angle = (n) => Math.atan2(n.y - CENTRE, n.x - CENTRE);

    let within = 0;
    let between = Infinity;

    for (let i = 1; i < placed.length; i++) {
      // Angular difference, wrapped — a group boundary can straddle ±π.
      let d = Math.abs(angle(placed[i]) - angle(placed[i - 1]));
      if (d > Math.PI) d = Math.PI * 2 - d;

      if (placed[i].type === placed[i - 1].type) within = Math.max(within, d);
      else between = Math.min(between, d);
    }

    assert.ok(
      between > within * 1.5,
      `${JSON.stringify(shape)}: gap ${between.toFixed(3)} is not clearly wider than the ` +
      `within-group step ${within.toFixed(3)} — the groups will read as one ring`
    );

  }

});


test("a lone group still gets a visible arc rather than a zero-length path", () => {

  const { sectors } = layout(neighbourhood({ task: 4, intention: 1 }));

  const lone = sectors.find(s => s.count === 1);

  assert.ok(lone, "the single-member group must exist");

  // A path whose start and end are the same point draws nothing at all.
  const points = lone.path.match(/-?\d+(\.\d+)?/g).map(Number);

  assert.ok(
    Math.hypot(points[0] - points[points.length - 2], points[1] - points[points.length - 1]) > 4,
    "the arc's endpoints are the same place — it will render as nothing"
  );

});


test("groups stay contiguous — a type is never split across the circle", () => {

  // The whole informational claim of this diagram is "these came from the same
  // table". Interleaved sectors would make that claim false.
  const { placed } = layout(neighbourhood({ task: 5, transaction: 4, person: 3 }));

  const order = placed.map(n => n.type);

  const seen = new Set();

  for (let i = 0; i < order.length; i++) {
    if (i > 0 && order[i] !== order[i - 1]) {
      assert.ok(!seen.has(order[i]), `${order[i]} appears in two separate runs`);
      seen.add(order[i - 1]);
    }
  }

});


test("the walk uses no layout library", () => {

  // Not a stylistic preference. A force simulation would scatter the type
  // groups into a lumpy ring and destroy the one informative thing on screen —
  // that a project reaches into four different tables — while being unable to
  // server-render or to read the CSS variables the design system runs on.
  const pkg = JSON.parse(read("web/package.json"));

  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  for (const banned of ["d3", "d3-force", "cytoscape", "sigma", "vis-network", "react-force-graph"]) {
    assert.ok(!deps.includes(banned), `${banned} was added — the layout here is deterministic on purpose`);
  }

});


test("a failed walk is reported, not rendered as an empty neighbourhood", () => {

  // Both failure shapes, same as InsightCard. A handler that threw arrives from
  // app/backend.js as { error } with no `success` key, so testing only
  // `success === false` would draw a 500 as "connected to nothing" — a
  // confident, wrong claim about someone's life.
  assert.match(
    viewSource,
    /result\?\.success === false \|\| result\?\.error/,
    "both failure shapes must be checked"
  );

  assert.match(viewSource, /setFailed/, "and the failure has to reach the screen");

});


test("relation direction survives being turned into a sentence", () => {

  // "memory mentions person" read backwards becomes "person mentions memory",
  // which is how an edge stops being evidence and starts being decoration.
  // The real case this got wrong. A note mentions a merchant, so the edge is
  // stored note --mentions--> merchant. Walking FROM the merchant, that edge is
  // incoming, and the caption — which puts the root first — must say the
  // merchant is *mentioned by* the note. It shipped saying the merchant
  // "mentions" the note: a true edge, an inverted and therefore false sentence.
  const noteOnMerchant = { relation: "mentions", direction: "in" };

  assert.equal(rootToNode(noteOnMerchant), "mentioned by", "the caption reads root → node");
  assert.equal(nodeToRoot(noteOnMerchant), "mentions", "the list row reads node → root");

  // A task belongs to a project; walking from the project the edge is incoming.
  const taskOnProject = { relation: "belongs_to", direction: "in" };

  assert.equal(rootToNode(taskOnProject), "contains");
  assert.equal(nodeToRoot(taskOnProject), "belongs to");

  // And the outgoing direction is the mirror of all of the above.
  for (const relation of Object.keys(RELATION_LABEL)) {
    assert.equal(
      rootToNode({ relation, direction: "out" }),
      nodeToRoot({ relation, direction: "in" }),
      `${relation}: the two readings must be exact mirrors`
    );
    assert.notEqual(
      rootToNode({ relation, direction: "in" }),
      nodeToRoot({ relation, direction: "in" }),
      `${relation}: one string cannot serve both directions`
    );
  }

  // An unfamiliar relation is rendered as itself rather than given an invented
  // inverse — mechanical in one direction, but never a fabricated claim.
  assert.equal(rootToNode({ relation: "funds", direction: "in" }), "funds");

  // Each function has exactly one caller, and they must not be swapped.
  assert.match(viewSource, /\{rootToNode\(chosen\)\}/, "the caption reads root → node");
  assert.match(viewSource, /\{nodeToRoot\(node\)\}/, "the list rows read node → root");

});


test("a charge and a merchant both say the number that makes them worth reading", () => {

  assert.equal(detail({ type: "transaction", extra: -146.8 }), "$146.80");
  assert.equal(detail({ type: "merchant", extra: 21 }), "21 charges");
  assert.equal(detail({ type: "merchant", extra: 1 }), "1 charge");
  assert.equal(detail({ type: "task", extra: 9 }), null);

  // A merchant with no count must not render "null charges".
  assert.equal(detail({ type: "merchant" }), null);

});


test("ember is not spent on the graph", () => {

  // Orange means one thing in this app: waiting on you. A diagram of what is
  // connected to what has nothing waiting on anybody, and fourteen entity types
  // would need fourteen hues that mean nothing — which is why grouping is
  // carried by position and an arc instead.
  const drawing = viewSource.slice(0, viewSource.indexOf("function AnchorList"));

  assert.ok(
    !/var\(--ember\)/.test(drawing),
    "the diagram must not use the reserved accent"
  );

});
