import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ENTITIES, LINKABLE, describeNeighbourhood, findMentions, merchantKey } from "../web/lib/links.js";
import { groupIntoVisits, looksLikeGym } from "../web/tools/location.js";
import { nodeToRoot, rootToNode, detail, moneyTotal, RELATION_LABEL } from "../web/app/graph/phrasing.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const islandsSource = read("web/tools/islands.js");
const linksSource = read("web/lib/links.js");
const dedupeSource = read("web/lib/dedupe.js");
const locationSource = read("web/tools/location.js");
const canvasSource = read("web/app/graph/GraphCanvas.js");


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
  //
  // The old version of this test matched only NUMERIC literals and scanned only
  // two files — so `.limit(MAX_ROWS_PER_TABLE)` (10,000) in islands.js and every
  // `.limit(5000)` in links.js sailed straight past it, which is exactly how two
  // silent-truncation sites survived on the graph's growth path. This matches
  // ANY argument and covers links.js too.
  // Strip comments first: this file's own explanations legitimately mention
  // `.limit(MAX_ROWS_PER_TABLE)` as the anti-pattern they replaced, and a raw
  // scan would flag the prose describing the fix as the bug.
  const stripComments = s => s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  for (const [name, raw] of [
    ["tools/islands.js", islandsSource],
    ["tools/location.js", locationSource],
    ["lib/links.js", linksSource]
  ]) {

    const source = stripComments(raw);

    for (const match of source.matchAll(/\.limit\(\s*([^)]+?)\s*\)/g)) {

      const arg = match[1];
      const asNumber = Number(arg);

      // A numeric literal is safe only if it is at or under the cap.
      if (Number.isFinite(asNumber)) {
        assert.ok(
          asNumber <= 1000,
          `${name} calls .limit(${arg}), above PostgREST's 1000-row cap — it will be ` +
          "silently truncated. Use selectAll() from lib/supabase.js instead."
        );
        continue;
      }

      // A non-literal argument is only allowed when it is a genuinely small
      // bound (a caller-supplied page size like `limit`), never a bulk "read
      // everything" constant that resolves above the cap.
      assert.doesNotMatch(
        arg,
        /MAX|ALL|ROWS|TOTAL|5000|10000/i,
        `${name} calls .limit(${arg}) — a bulk constant that can exceed PostgREST's 1000-row ` +
        "cap and be silently truncated. Use selectAll() from lib/supabase.js instead."
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
// The full graph read behind the force view.
// ---------------------------------------------------------------------------

test("the whole-graph read exists, is bounded, and drops half-resolved edges", () => {

  const body = linksSource.slice(
    linksSource.indexOf("export async function fullGraph"),
    linksSource.indexOf("// The things actually worth looking at")
  );

  // Bounded by construction — at 5,000 edges the answer is a slightly stale
  // graph, not a timeout.
  assert.match(body, /limit = 5000/);

  // A link either of whose ends fails to resolve is not drawn. Same posture
  // as walk(), applied to the pair.
  assert.match(body, /!rows\.get\(from\)\?\.label \|\| !rows\.get\(to\)\?\.label/);

  // val is DISTINCT neighbours, not edge count — the lesson graphAnchors
  // already paid for when a project advertised 24 and drew 23.
  assert.match(body, /neighbourSets\.get\(key\)\.size/);

  // Labels are trimmed server-side: an intention is a whole sentence, and 180
  // of those serialise into the page HTML.
  assert.match(body, /slice\(0, 69\)/);

});


test("the graph endpoint is read-only", () => {

  const handler = read("web/app/api/[resource]/handler.js");

  const body = handler.slice(
    handler.indexOf("async function graph(req, res)"),
    handler.indexOf("const RESOURCES =")
  );

  assert.match(body, /req\.method !== "GET"/, "it must reject anything but GET");
  assert.match(body, /fullGraph\(\)/, "and answer with the whole resolved graph");

  for (const write of ["upsert", "insert", "update", "delete", "link("]) {
    assert.ok(!body.includes(write), `the graph endpoint must never ${write} — looking is not recording`);
  }

});


// ---------------------------------------------------------------------------
// The canvas. A deliberate reversal is pinned here: the first version of this
// page used no layout library and a deterministic radial layout, and the user
// overruled it — the Obsidian-style force view is the feature. What stays
// non-negotiable is WHICH library and what the canvas may not do.
// ---------------------------------------------------------------------------

test("flat is the default engine; the sphere is its one sanctioned sibling", () => {

  // The layout choice is deliberate and pinned: force-graph (2D canvas) is
  // the default, and 3d-force-graph — same author, same API — is allowed
  // because the user chose the sphere experiment, loaded only on demand.
  // The analysis-grade candidates stay out: they solve dataset sizes this
  // graph is bounded away from ever reaching, at real bundle cost.
  const pkg = JSON.parse(read("web/package.json"));

  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  assert.ok(deps.includes("force-graph"), "the 2D engine must be the one installed");
  assert.ok(deps.includes("3d-force-graph"), "the sphere experiment ships behind its toggle");

  for (const banned of ["d3", "cytoscape", "sigma", "react-force-graph", "vis-network", "three-spritetext"]) {
    assert.ok(!deps.includes(banned), `${banned} was added — see the library rationale in GraphCanvas.js`);
  }

});


test("the engine is imported dynamically, never at module scope", () => {

  // force-graph touches window at import time. A static import puts it in the
  // server bundle and the page dies at build — the failure arrives as a build
  // error about `window`, far from this file.
  assert.doesNotMatch(canvasSource, /^import .*force-graph/m);
  assert.match(canvasSource, /import\("force-graph"\)/);

});


test("reduced motion gets a settled graph, not a slow-motion one", () => {

  // The OS setting means no animation — so the simulation runs its ticks
  // BEFORE first paint and renders already settled, rather than animating
  // slowly at the user anyway.
  assert.match(canvasSource, /reducedMotion\(\)/);
  assert.match(canvasSource, /warmupTicks\(still \? 300 : 60\)/);
  assert.match(canvasSource, /cooldownTicks\(still \? 0 : undefined\)/);

  // And for everyone else the settle is seconds, not the library default —
  // the fifteen-second drift was most of the first complaint about this page.
  assert.match(canvasSource, /cooldownTime\(4000\)/);

});


test("the camera frames the settle until the user takes over", () => {

  // The physics has nothing anchoring it to the viewport — the first render
  // settled half the net off a phone's right edge and stayed there until a
  // single jump-cut fifteen seconds in. So the whole graph is re-framed every
  // engine tick, and the first pointer on the canvas ends it permanently: a
  // camera the user is holding must never move itself.
  assert.match(canvasSource, /onEngineTick\(\(\) => \{\s*if \(!cameraOwnedRef\.current\) fg\.zoomToFit\(0, 60\);/);
  assert.match(canvasSource, /addEventListener\("pointerdown", takeCamera, \{ capture: true \}\)/);

  // The recentre control is the one way to hand the camera back.
  assert.match(canvasSource, /cameraOwnedRef\.current = false/);

  // And a final fit at engine stop, because the per-tick refit depends on
  // ticks happening at all: cooldownTime is wall-clock, and a tab loaded in
  // the background has its frames paused while that clock runs.
  assert.match(canvasSource, /if \(!cameraOwnedRef\.current\) fg\.zoomToFit\(400, 60\)/);

});


test("disconnected islands share one bounded world", () => {

  // Components with no edge between them repel each other for as long as the
  // simulation runs — an expanseless plane, and the reason the final frame
  // was too far out to read. The weak centring forces are the leash: they
  // gather without crushing, and when future data joins two islands nothing
  // here changes.
  assert.match(canvasSource, /forceX\(0\)\.strength/);
  assert.match(canvasSource, /forceY\(0\)\.strength/);

  // Zoom is clamped in both directions — there is nowhere to get lost.
  assert.match(canvasSource, /minZoom\(0\.3\)/);
  assert.match(canvasSource, /maxZoom\(10\)/);

});


test("one spread control moves every force that defines scale", () => {

  // Repulsion, link length and personal space tuned separately WILL drift
  // into disagreement. applySpread is the single place scale exists, the
  // slider is its only UI, and changing it re-settles the world.
  const body = canvasSource.slice(
    canvasSource.indexOf("function applySpread"),
    canvasSource.indexOf("const SPREAD_MIN")
  );

  assert.match(body, /d3Force\("charge"\)/);
  assert.match(body, /d3Force\("link"\)/);
  assert.match(body, /forceCollide/);

  assert.match(canvasSource, /type="range"/, "the slider must exist");
  assert.match(canvasSource, /d3ReheatSimulation\(\)/, "and moving it must re-settle the layout");

});


test("labels are not allowed to land on each other", () => {

  // At mid-zoom, forty labels arriving at once used to stack into an
  // unreadable smear. Two rules fix it: the threshold scales with degree
  // (hubs speak first), and every label this frame checks the rectangles
  // already drawn and waits its turn if occupied. Priority is draw order,
  // which is degree order, pinned by the sort.
  assert.match(canvasSource, /scale \* Math\.sqrt\(node\.val \|\| 1\) > \(isCharge \? 6 : 3\.2\)/);
  assert.match(canvasSource, /labelRectsRef\.current = \[\]/, "the ledger must reset every frame");
  assert.match(canvasSource, /measureText\(text\)/, "widths must be measured, not guessed");

  // And a charge does not repeat its merchant's name — eight dots all saying
  // "Fenwick Market" is noise wearing a label. A charge speaks its amount,
  // and only at a much closer zoom than named things.
  assert.match(canvasSource, /isCharge \? 6 : 3\.2/);
  assert.match(canvasSource, /toFixed\(0\)/, "the charge label is its rounded amount");
  assert.match(canvasSource, /\.sort\(\(a, b\) => \(b\.val \|\| 0\) - \(a\.val \|\| 0\)\)/);

});


test("the overview names its islands — in the chrome, never on the canvas", () => {

  // Titles were first drawn at each component's centroid and failed twice at
  // once: a title could be a 20-word intention sentence, and several landed
  // on the graph and each other at overview zoom. Now the header caption
  // names whichever island dominates the viewport, and the post-frame hook
  // only MEASURES — it draws nothing.
  const post = canvasSource.slice(
    canvasSource.indexOf(".onRenderFramePost"),
    canvasSource.indexOf(".nodePointerAreaPaint")
  );

  assert.ok(post.length > 0, "the viewport measurement hook must exist");
  assert.doesNotMatch(post, /strokeText|fillText/, "the canvas must not draw island titles");

  const measure = canvasSource.slice(
    canvasSource.indexOf("const computeCaption"),
    canvasSource.indexOf(".onRenderFramePre")
  );

  assert.match(measure, /screen2GraphCoords/, "dominance is measured against the real viewport");

  // Rendering pauses when the physics does, so a caption computed only
  // per-frame would never appear on a page that settled in a background tab.
  assert.match(canvasSource, /setTimeout\(computeCaption, 500\)/, "the caption must also compute at engine stop");

  assert.match(canvasSource, /const find = \(x\)/, "components must come from a union-find, not a guess");
  assert.match(canvasSource, /aria-live="polite"/, "the caption is chrome, announced politely");

});


test("an island's title is a name, not a paragraph", () => {

  // The strongest member of an island can be an intention — a whole sentence.
  // A title is a handle: nameable types (project, person, merchant, category,
  // place) win even over a higher-degree prose node, and whatever wins is
  // hard-truncated.
  assert.match(canvasSource, /const NAMEABLE = new Set\(\["project", "person", "merchant", "category", "place"\]\)/);
  assert.match(canvasSource, /nameable\.length > 0 \? nameable : members/, "prose is the fallback, never the preference");
  assert.match(canvasSource, /title\.length > 26/, "and even a name gets truncated");

});


test("selecting a node never yanks the camera", () => {

  // The first version zoomed to 2.2× on every tap and the shape of the graph
  // was lost each time. Zoom may only nudge IN, never past 1.5 — and never
  // OUT — and the node is centred above the card's space, not underneath it.
  const settle = canvasSource.slice(
    canvasSource.indexOf("const settleOn"),
    canvasSource.indexOf("const clickNode")
  );

  assert.match(settle, /Math\.max\(zoom, 1\.5\)/);
  assert.match(settle, /if \(zoom < 1\.5\) fg\.zoom\(1\.5, 400\)/);
  assert.match(settle, /clientHeight \* 0\.14/, "the landing point clears the card");
  assert.doesNotMatch(canvasSource, /zoom\(2\.2/, "the old jump must not survive anywhere");

});


test("the card takes a quarter of the screen, not half", () => {

  assert.match(canvasSource, /max-h-\[26vh\]/);
  assert.doesNotMatch(canvasSource, /max-h-\[42vh\]/);

});


test("the sphere is an opt-in that the flat view never pays for", () => {

  // three.js is ~600KB. It loads on the FIRST toggle only — a static import
  // would ship it to every visitor of a page whose default never uses it.
  assert.doesNotMatch(
    canvasSource,
    /^import .*3d-force-graph/m,
    "3d-force-graph must never be imported statically"
  );

  assert.match(canvasSource, /import\("3d-force-graph"\)/, "it arrives inside the toggle handler");
  assert.doesNotMatch(canvasSource, /^import .*"three"/m, "and three.js is dynamic for the same reason");
  assert.match(canvasSource, /useState\("flat"\)/, "and flat is the default");

  // A sphere that fails to load costs the tap and nothing else.
  const handler = canvasSource.slice(
    canvasSource.indexOf("const enterSphere"),
    canvasSource.indexOf("const enterFlat")
  );
  assert.match(handler, /catch \(error\)/, "the import failure must be caught");
  assert.match(handler, /setMode\("flat"\)/, "and fall back to the working view");

  // And caught LOUDLY. This catch once swallowed a real setup bug during the
  // sphere's own verification, making a broken sphere indistinguishable from
  // a slow network.
  assert.match(handler, /console\.error\("SPHERE FAILED:/, "the reason must reach the console");

});


test("the sphere cleans up its own timer", () => {

  // The hemisphere caption runs on an interval. An unmount that only killed
  // the renderer would leave it polling a dead scene forever.
  assert.match(canvasSource, /clearInterval\(captionTimer\)/);

});


test("every entity type the registry knows has a family on the canvas", () => {

  // A type missing from FAMILY silently falls into "notes" — survivable — but
  // a map drifting from the registry is exactly how nudge edges once became
  // unreadable. Compare the canvas's literal against the registry itself.
  const familyBlock = canvasSource.slice(
    canvasSource.indexOf("const FAMILY = {"),
    canvasSource.indexOf("const FAMILIES =")
  );

  for (const type of Object.keys(ENTITIES)) {
    assert.match(
      familyBlock,
      new RegExp(`\\b${type}:`),
      `ENTITIES knows "${type}" but the canvas assigns it no family`
    );
  }

});


test("ember is not spent on the graph", () => {

  // Orange means one thing in this app: waiting on you. A graph has nothing
  // waiting on anybody, so the canvas draws with the identity colours and the
  // reserved accent appears nowhere in this file.
  assert.ok(!canvasSource.includes("--ember"), "the canvas must not use the reserved accent");

});


test("a deep link still lands centred on its subject", () => {

  // The Connections links on project, person and insight cards carry ?type&id
  // and have promised arrival-in-context since the first version of this
  // page. The force view honours it after layout settles, once.
  assert.match(canvasSource, /onEngineStop/);
  assert.match(canvasSource, /n\.id === focus/);

  // And the deep-link zoom only fires if the user hasn't already taken the
  // camera — a camera the user is holding must never move itself.
  assert.match(canvasSource, /target && !cameraOwnedRef\.current/);

  const page = read("web/app/graph/page.js");
  assert.match(page, /params\?\.type && params\?\.id/, "the page must still read the deep-link params");

});


test("hiding a family never rebuilds the layout", () => {

  // Filters act through refs and visibility callbacks. Rebuilding the engine
  // on toggle would reshuffle every node under the user's thumb — the layout
  // is a place, and places do not rearrange because you squinted.
  assert.match(canvasSource, /nodeVisibility/);
  assert.match(canvasSource, /hiddenRef\.current/);

});


// ---------------------------------------------------------------------------
// Phrasing — the sentences over the edges. Unchanged from the radial view,
// because a claim about someone's life is checked wherever it is rendered.
// ---------------------------------------------------------------------------

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

  // The selection card's neighbour rows are neighbour-first sentences, so
  // they must use the node→root reading, with direction taken from which end
  // of the stored edge the selection sits at.
  assert.match(canvasSource, /nodeToRoot\(\{ relation, direction \}\)/);
  assert.match(canvasSource, /l\.source === selected\.id \? "out" : "in"/);

});


test("a selection's money is summed in code, absolutely, from charges only", () => {

  // "What did this cost" answered by arithmetic on the amounts the server
  // attached — never by a model, and never flattered by refunds: absolute
  // values, because the question is how much money MOVED.
  const rows = [
    { type: "transaction", extra: -146.8 },
    { type: "transaction", extra: 62.4 },
    { type: "transaction", extra: -0 },
    { type: "task", extra: 99 },        // not money, ignored
    { type: "merchant", extra: 21 },    // txn_count, not an amount, ignored
    { type: "transaction" }             // no amount recorded, ignored
  ];

  const { total, count } = moneyTotal(rows);

  assert.equal(count, 3);
  assert.ok(Math.abs(total - 209.2) < 1e-9);

  assert.deepEqual(moneyTotal([]), { count: 0, total: 0 });
  assert.deepEqual(moneyTotal(null), { count: 0, total: 0 });

  // And the card actually uses it.
  assert.match(canvasSource, /moneyTotal\(neighbourRows\.map/);

});


test("a charge and a merchant both say the number that makes them worth reading", () => {

  assert.equal(detail({ type: "transaction", extra: -146.8 }), "$146.80");
  assert.equal(detail({ type: "merchant", extra: 21 }), "21 charges");
  assert.equal(detail({ type: "merchant", extra: 1 }), "1 charge");
  assert.equal(detail({ type: "task", extra: 9 }), null);

  // A merchant with no count must not render "null charges".
  assert.equal(detail({ type: "merchant" }), null);

});
