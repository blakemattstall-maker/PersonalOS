import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { TOOLS } from "../web/lib/toolDefinitions.js";
import { buildClassifierPrompt } from "../web/tools/staleness.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


// ---------------------------------------------------------------------------
// The freshness incident, pinned. A cut-analysis capture was answered by the
// finance tool ("no access to a weigh-in trend") while nineteen dated weigh-ins
// sat readable; a morning nudge did arithmetic on a bio sentence four pounds
// stale. The disease was structural: fresh truth computed, then not handed to
// the surfaces that speak. These tests fail if any limb of the cure regresses.
// ---------------------------------------------------------------------------


test("the router has a tool that can actually read the body", () => {

  const names = TOOLS.map(t => t.function.name);

  assert.ok(names.includes("query_health"), "query_health must exist — its absence is what scattered the cut question across finance/tasks/notes");
  assert.ok(names.includes("log_bodyweight"), "the write half still exists");

  const health = TOOLS.find(t => t.function.name === "query_health");
  assert.match(health.function.description, /cut/i, "the router routes by description — 'cut' must appear in it");

  const general = TOOLS.find(t => t.function.name === "general_question");
  assert.doesNotMatch(general.function.description, /memory\/context only/, "the old wording invited the router to assume the answerer had no data");
  assert.match(general.function.description, /never assume/i);

});


test("the catch-all reasoner and the health tool always get the user's verbatim words", () => {

  const handler = read("web/app/api/capture/handler.js");

  // The router once rephrased the question into "...if I don't have the
  // user's exact stats?" on a multi-tool turn — a rephrase must never assert
  // facts about what the system knows.
  assert.match(handler, /wantsVerbatim = toolName === "general_question" \|\| toolName === "query_health"/);
  assert.match(handler, /isMultiAction && !wantsVerbatim \? null : text/);

  const router = read("web/lib/router.js");
  assert.match(router, /case "query_health":/);
  assert.match(router, /answerHealthQuestion\(\{\s*question: originalText \|\| data\.question/);

});


test("the body line rides in signals, so every reasoning surface holds it", () => {

  const signals = read("web/lib/signals.js");

  assert.match(signals, /vitals\.js.*bodySignal|bodySignal/s, "buildSignals must include the vitals body line");
  assert.match(signals, /body && `Body: \$\{body\}`/);

});


test("memories carry their dates everywhere a model reads them", () => {

  const memory = read("web/tools/memory.js");
  assert.match(memory, /noted: memory\.created_at\.slice\(0, 10\)/);

  const dedupe = read("web/lib/dedupe.js");
  assert.match(dedupe, /noted \$\{c\.created_at/, "the dedupe classifier judges update/conflict — it must see dates");

  const profileEvolution = read("web/tools/profileEvolution.js");
  assert.match(profileEvolution, /noted \$\{String\(m\.created_at\)/);
  // The old prompt line, verbatim — it claimed importance-ordered memories
  // were newest-first and arbitrated conflicts on that false recency.
  assert.doesNotMatch(profileEvolution, /learned about them since, newest first/);

});


test("no prompt interpolates the memories object — the [object Object] class is dead", () => {

  for (const file of ["web/tools/news.js", "web/tools/gmail.js", "web/tools/googleDocs.js"]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\[context\.bio, context\.memories\]/,
      `${file} must join memoriesText, not the memories object`
    );
  }

  const gmail = read("web/tools/gmail.js");
  assert.doesNotMatch(gmail, /Who they are:\\n\$\{context\}/, "reviewInbox must interpolate rendered fields, never the context object");

  const context = read("web/lib/context.js");
  assert.match(context, /memoriesText: formatMemoriesText\(memories\)/);

});


test("the surfaces that speak now hold the figures", () => {

  const nudges = read("web/tools/nudges.js");
  assert.match(nudges, /context\.bodyweightTrend/, "the nudge evaluator produced the stale-bio nudge — it must hold the real trend");
  assert.match(nudges, /OUTRANK/, "and be told logs beat prose");

  const thread = read("web/tools/thread.js");
  const signalBlocks = thread.match(/context\.signals/g) || [];
  assert.ok(signalBlocks.length >= 2, "thread replies AND plan builds must render signals (both fetched and dropped them)");

  const answer = read("web/tools/answer.js");
  assert.match(answer, /context\.insights/, "answer fetched insights and never interpolated them");
  assert.match(answer, /Never claim you lack access to weight or body data/);

});


test("the bio rewrite reads the scale", () => {

  const source = read("web/tools/profileEvolution.js");

  assert.match(source, /computeBodyVitals/, "regenerateBio must fold in measured vitals — memories alone can never correct a stale weight");
  assert.match(source, /measured figure beats prose/i);
  assert.match(source, /updated_at: new Date\(\)\.toISOString\(\)/, "the rewrite must stamp updated_at so bio staleness is answerable");

});


test("review findings stay fixed: promptKind, sticky keep, re-embed, truncation side", () => {

  // Four real defects the pre-deploy adversarial review caught. Each was
  // confirmed by inspection; each would have shipped silently.

  // 1. page.js overwrites item.kind with "prompt" for card dispatch — every
  //    kind branch inside PromptCard must read the preserved promptKind, or
  //    it is dead code (HEADINGS[item.kind] had silently never resolved).
  const page = read("web/app/page.js");
  assert.match(page, /promptKind: p\.kind/);

  const promptCard = read("web/app/PromptCard.js");
  assert.match(promptCard, /const promptKind = item\.promptKind \|\| item\.kind/);
  assert.doesNotMatch(promptCard, /item\.kind === "(label_place|stale_review)"/);

  // 2. "Keep" must stick — but pardon the TEXT, not the row id forever. The
  //    bio is rewritten weekly under one permanent id, so an id-keyed pardon
  //    would exempt it from every future sweep even once its wording had
  //    changed completely.
  const staleness = read("web/tools/staleness.js");
  assert.match(staleness, /startsWith\("keep"\)/);
  assert.match(staleness, /pardoned != null && pardoned !== c\.content/);

  // 3. A rewritten memory must re-embed, or vector retrieval keeps matching
  //    the stale wording forever.
  assert.match(staleness, /embed\(payload\.suggested\)/);

  // 4. The vitals read must truncate the OLD side, never the new one.
  const vitals = read("web/lib/vitals.js");
  assert.match(vitals, /ascending: false/);

  // 5. Graph edges must take their type from the registry. "memories" chopped
  //    to "memorie" inserts orphan rows no reader resolves and pruneDangling
  //    never collects, because it only prunes types it recognises.
  assert.doesNotMatch(staleness, /replace\(\/s\$\/, ""\)/);
  assert.match(staleness, /TYPE_BY_TABLE\[payload\.table\]/);

});


test("the table-to-type map is inverted from the registry, and is right", async () => {

  const { TYPE_BY_TABLE, ENTITIES } = await import("../web/lib/links.js");

  assert.equal(TYPE_BY_TABLE.memories, "memory", "the bug that started this: memories -> memory, never memorie");
  assert.equal(TYPE_BY_TABLE.notes, "note");
  assert.equal(TYPE_BY_TABLE.intentions, "intention");

  // Inverted, not hand-maintained — every entity must round-trip.
  for (const [type, spec] of Object.entries(ENTITIES)) {
    assert.equal(TYPE_BY_TABLE[spec.table], type, `${spec.table} must map back to ${type}`);
  }

});


test("the staleness sweep is wired: nightly detection, prompt kind, resolution", () => {

  const cron = read("web/app/api/cron/[job]/handler.js");
  assert.match(cron, /sweepStaleFacts/);

  const staleness = read("web/tools/staleness.js");
  assert.match(staleness, /kind: "stale_review"/);

  const promptCard = read("web/app/PromptCard.js");
  assert.match(promptCard, /stale_review/);
  assert.match(promptCard, /submit\("keep"\)/);

  const resource = read("web/app/api/[resource]/handler.js");
  assert.match(resource, /stale_review/);
  assert.match(resource, /resolveStaleReview/);

});


test("the staleness classifier's rules protect goals and history", () => {

  const prompt = buildClassifierPrompt("Bodyweight: 216.2 lbs as of Aug 20", [
    { table: "memories", content: "goal weight 190", created_at: "2026-08-06" }
  ]);

  // The rules ride inside the prompt itself — a goal or a historical statement
  // must never be flagged as stale, and doubt must resolve to silence.
  assert.match(prompt, /NOT[\s\S]{0,40}stale — it is a want/);
  assert.match(prompt, /historical statement/i);
  assert.match(prompt, /When in doubt, do not flag/);
  assert.match(prompt, /\[memories, noted 2026-08-06\] goal weight 190/);

});


test("calorie columns can finally trend once meals are logged", () => {

  const trends = read("web/lib/trends.js");
  assert.match(trends, /calories_eaten/);
  assert.match(trends, /protein_eaten/);

  const observer = read("web/tools/observer.js");
  assert.match(observer, /calories_eaten/);

});
