import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { groupFindings } from "../web/tools/islands.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const islandsSource = read("web/tools/islands.js");
const contextSource = read("web/lib/context.js");
const linksSource = read("web/lib/links.js");


const finding = (kind, refs, strength = 0.5) => ({
  kind,
  strength,
  fingerprint: `${kind}:${refs.map(r => r.id).join(",")}`,
  refs,
  facts: {}
});


// ---------------------------------------------------------------------------
// Two findings about one thing are one story.
// ---------------------------------------------------------------------------

test("findings that share an entity become a single group", () => {

  // The case this was built for: a project is costing money AND the person
  // attached to it has gone quiet. Two detectors, one situation, and before
  // this it was two separate notifications out of a budget of one a day.
  const groups = groupFindings([
    finding("project_cost", [{ type: "project", id: "p1" }], 0.6),
    finding("relationship_debt", [{ type: "project", id: "p1" }], 0.9)
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 2);
  assert.equal(groups[0].kind, "synthesis", "a merged group is not any one of its members' kinds");

});


test("findings about unrelated things stay apart", () => {

  const groups = groupFindings([
    finding("project_cost", [{ type: "project", id: "p1" }]),
    finding("relationship_debt", [{ type: "person", id: "x9" }])
  ]);

  assert.equal(groups.length, 2);
  assert.ok(groups.every(g => g.kind !== "synthesis"), "a group of one keeps its own kind");

});


test("grouping is transitive", () => {

  // A shares a project with B; B shares a spending category with C. All three
  // are one story, and a naive pairwise pass would report two.
  const groups = groupFindings([
    finding("project_cost", [{ type: "project", id: "p1" }]),
    finding("contradiction", [{ type: "project", id: "p1" }, { type: "category", id: "eating out" }]),
    finding("concentration", [{ type: "category", id: "eating out" }])
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);

});


test("a group speaks as loudly as its strongest member", () => {

  const groups = groupFindings([
    finding("project_cost", [{ type: "project", id: "p1" }], 0.3),
    finding("relationship_debt", [{ type: "project", id: "p1" }], 0.95)
  ]);

  assert.equal(groups[0].strength, 0.95);
  assert.equal(groups[0].members[0].kind, "relationship_debt", "members are ordered strongest first");

});


test("groups are ordered so the strongest is raised first", () => {

  const groups = groupFindings([
    finding("concentration", [{ type: "category", id: "shopping" }], 0.2),
    finding("project_cost", [{ type: "project", id: "p1" }], 0.8)
  ]);

  assert.deepEqual(groups.map(g => g.strength), [0.8, 0.2]);

});


// ---------------------------------------------------------------------------
// The fingerprint is what stops the same thing being said twice.
// ---------------------------------------------------------------------------

test("a group's fingerprint does not depend on detection order", () => {

  // Detectors run in a fixed order today, but the finding list is sorted by
  // strength — and strength moves with real numbers. If the fingerprint moved
  // with it, the same standing situation would be re-raised as new whenever
  // one member overtook the other.
  const a = finding("project_cost", [{ type: "project", id: "p1" }], 0.4);
  const b = finding("relationship_debt", [{ type: "project", id: "p1" }], 0.6);

  assert.equal(
    groupFindings([a, b])[0].fingerprint,
    groupFindings([b, a])[0].fingerprint
  );

});


test("a group's fingerprint contains every member, so nothing is lost", () => {

  const groups = groupFindings([
    finding("project_cost", [{ type: "project", id: "p1" }]),
    finding("relationship_debt", [{ type: "project", id: "p1" }])
  ]);

  for (const member of groups[0].members) {
    assert.ok(
      groups[0].fingerprint.includes(member.fingerprint),
      "a member absent from the composite could be re-raised alone tomorrow"
    );
  }

});


test("a finding with no refs is still surfaced, alone", () => {

  // Defensive: a future detector that forgets `refs` must not silently vanish.
  const groups = groupFindings([
    { kind: "mystery", strength: 0.5, fingerprint: "mystery:1", facts: {} }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 1);

});


test("grouping happens before the already-said check, not after", () => {

  // If the known-check ran first, a group's second member would survive on its
  // own the night after the group was raised and arrive as a separate
  // notification about a situation already described.
  const groupIndex = islandsSource.indexOf("const groups = groupFindings(findings)");
  const knownIndex = islandsSource.indexOf('.from("insights")\n    .select("fingerprint")');

  assert.ok(groupIndex > 0 && knownIndex > 0, "both steps must exist");
  assert.ok(groupIndex < knownIndex, "grouping must come first");

});


test("both composite and member fingerprints are checked as already-said", () => {

  assert.match(
    islandsSource,
    /const allFingerprints = \[[\s\S]*groups\.map\(g => g\.fingerprint\)[\s\S]*findings\.map\(f => f\.fingerprint\)/,
    "a group must be recognised whether it was raised whole or a member was raised alone"
  );

});


// ---------------------------------------------------------------------------
// The line that must not be crossed.
// ---------------------------------------------------------------------------

test("phrasing is given raw facts, never another insight's output", () => {

  // Grouping findings is arithmetic and is safe. Deriving one finding from
  // another finding's PHRASING is not — a chain of inferences starts sounding
  // more certain than any link in it, and "compute in code, model only
  // phrases" is what breaks first. The prompt must receive facts.
  // Scoped to what the model RECEIVES — the user message — rather than to the
  // whole call, because the row built afterwards legitimately handles `body`:
  // that is the model's output on its way to the database, which is the
  // opposite direction and is fine.
  const phrasing = islandsSource.slice(islandsSource.indexOf("const response = await openai"));

  const userMessage = phrasing.slice(
    phrasing.indexOf('role: "user"'),
    phrasing.indexOf("let phrased")
  );

  assert.match(
    userMessage,
    /group\.members\.map\(m => \(\{ kind: m\.kind, facts: m\.facts \}\)\)/,
    "the model must be handed each member's raw detected facts"
  );

  assert.doesNotMatch(
    userMessage,
    /\bbody\b/,
    "no previously phrased insight body may be fed back in as evidence — that is " +
    "the chain-of-inference line this design does not cross"
  );

  assert.doesNotMatch(
    userMessage,
    /recentInsights|insights\.body/,
    "and no stored insight may become an input to detecting a new one"
  );

});


test("an insight keeps the evidence that produced it", () => {

  // `entities` used to store one finding's `facts` under a name that suggested
  // entity refs. A synthesised insight has several sources, and a claim whose
  // evidence is unrecoverable cannot be checked later.
  assert.match(
    islandsSource,
    /entities:\s*\{[\s\S]{0,200}findings:[\s\S]{0,200}refs:/,
    "both the findings and their entity refs must be stored"
  );

});


// ---------------------------------------------------------------------------
// Clearing an insight has to be able to fail visibly.
// ---------------------------------------------------------------------------

test("resolving an insight reports failure instead of throwing", () => {

  // Thrown, a bad id takes the whole dashboard to Next's "This page couldn't
  // load" — there is no error.js anywhere in this app — for a button that
  // clears one card.
  const body = read("web/tools/islands.js").slice(
    read("web/tools/islands.js").indexOf("export async function resolveInsight")
  ).slice(0, 1600);

  assert.doesNotMatch(body, /throw new Error/, "a failed clear must not take the page down");
  assert.match(body, /success: false/, "it must say it failed");
  assert.match(body, /data\.length === 0/, "an update matching no rows is not a success");

});


test("the card checks both shapes a failure can arrive in", () => {

  // Trap #15, with a twist that nearly shipped. A failure this code returns
  // deliberately looks like { success: false }. A handler that threw is turned
  // by app/backend.js into { error: "Request failed with 500" } — no `success`
  // key at all — so testing only `success === false` treats a 500 as success
  // and silently clears a card whose row was never touched.
  const card = read("web/app/InsightCard.js");

  assert.match(
    card,
    /result\?\.success === false \|\| result\?\.error/,
    "both failure shapes must be checked"
  );

  assert.match(card, /setFailed/, "and the failure has to reach the screen");

});


// ---------------------------------------------------------------------------
// Connection-aware context.
// ---------------------------------------------------------------------------

test("connections are only fetched when there is a query to anchor on", () => {

  // The observer, the brief and nudge review all call buildRichContext with no
  // query, deliberately — they scan everything. They must pay nothing for a
  // lookup that needs a subject.
  assert.match(
    contextSource,
    /query\s*\n?\s*\?\s*import\("\.\/links\.js"\)/,
    "connectionsForText must be behind a query check"
  );

});


test("naming nothing costs no database work", () => {

  // The property that makes this affordable in every reasoning call: the
  // roster is cached and the match is a regex, so a question mentioning no
  // known entity returns before any walk is issued.
  const body = linksSource.slice(
    linksSource.indexOf("export async function connectionsForText"),
    linksSource.indexOf("// ── Recognising entities in text")
  );

  const earlyReturn = body.indexOf("if (anchors.length === 0) return null");
  const firstWalk = body.indexOf("walk({");

  assert.ok(earlyReturn > 0, "there must be an early return when nothing is named");
  assert.ok(earlyReturn < firstWalk, "and it must come before any traversal");

});


test("a walk carried into every prompt stays bounded", () => {

  const body = linksSource.slice(linksSource.indexOf("export async function connectionsForText"));

  assert.match(body.slice(0, 900), /maxAnchors = 2/, "at most two anchors per call");
  assert.match(body.slice(0, 900), /perAnchor = 8/, "and a hard node cap per anchor");
  assert.match(body.slice(0, 1600), /depth: 1/, "one hop — depth 2 is for an explicit walk, not for every prompt");

});
