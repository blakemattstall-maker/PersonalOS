import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ENTITIES, LINKABLE, describeNeighbourhood, findMentions } from "../web/lib/links.js";
import { groupIntoVisits, looksLikeGym } from "../web/tools/location.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const islandsSource = read("web/tools/islands.js");
const linksSource = read("web/lib/links.js");
const dedupeSource = read("web/lib/dedupe.js");
const locationSource = read("web/tools/location.js");


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
