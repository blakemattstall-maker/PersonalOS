import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { pathFor, buildPipeline, pipelineSummary, STAGES, GHOST_AFTER_DAYS } from "../web/lib/pipeline.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();


// ---------------------------------------------------------------------------
// A Sankey is made of TRANSITIONS, not states, and its whole value is being
// honest about proportion. If the arithmetic is wrong the picture lies
// confidently, which is worse than having no picture.
// ---------------------------------------------------------------------------


test("an application's path is its history, not just where it ended", () => {

  const { path, current } = pathFor([
    { stage: "applied", occurred_at: daysAgo(40) },
    { stage: "first_round", occurred_at: daysAgo(30) },
    { stage: "rejected", occurred_at: daysAgo(20) }
  ]);

  assert.deepEqual(path, ["applied", "first_round", "rejected"]);
  assert.equal(current, "rejected");

});


test("silence becomes 'no response' on its own, and never has to be marked", () => {

  // Nobody hand-marks a hundred silences, and nobody sends a rejection they
  // never wrote.
  const quiet = pathFor([{ stage: "applied", occurred_at: daysAgo(GHOST_AFTER_DAYS + 5) }]);

  assert.equal(quiet.current, "ghosted");
  assert.equal(quiet.derived, true);
  assert.deepEqual(quiet.path, ["applied", "ghosted"]);

  // Still early: pending, not ghosted.
  const recent = pathFor([{ stage: "applied", occurred_at: daysAgo(3) }]);
  assert.equal(recent.current, "applied");
  assert.equal(recent.derived, false);

  // And a real reply always beats the inference.
  const answered = pathFor([
    { stage: "applied", occurred_at: daysAgo(60) },
    { stage: "rejected", occurred_at: daysAgo(1) }
  ]);
  assert.equal(answered.current, "rejected");

});


test("the same stage recorded twice is an edit, not a loop", () => {

  const { path } = pathFor([
    { stage: "applied", occurred_at: daysAgo(10) },
    { stage: "applied", occurred_at: daysAgo(9) }
  ]);

  assert.deepEqual(path, ["applied"], "a node must never flow into itself");

});


test("what leaves a node equals what entered it", () => {

  // The rule that makes a Sankey trustworthy. Build a shape like Blake's own
  // chart and check the books balance.
  const m = new Map();
  let id = 0;
  const add = (...stages) => m.set(++id, stages.map(([s, d]) => ({ stage: s, occurred_at: daysAgo(d) })));

  for (let i = 0; i < 84; i++) add(["applied", 40], ["rejected", 30]);
  for (let i = 0; i < 109; i++) add(["applied", 40]);                       // silent -> derived
  for (let i = 0; i < 3; i++) add(["applied", 40], ["first_round", 30], ["rejected", 20]);
  for (let i = 0; i < 2; i++) add(["applied", 40], ["first_round", 30], ["withdrawn", 20]);
  for (let i = 0; i < 2; i++) add(["applied", 40], ["first_round", 30], ["second_round", 20], ["rejected", 10]);
  add(["applied", 40], ["first_round", 30], ["second_round", 20], ["offer", 5]);

  const p = buildPipeline(m);

  const node = (s) => p.nodes.find(n => n.stage === s)?.count || 0;
  const flow = (a, b) => p.flows.find(f => f.from === a && f.to === b)?.count || 0;

  assert.equal(p.applications, 201);
  assert.equal(node("applied"), 201);
  assert.equal(node("ghosted"), 109);
  assert.equal(node("first_round"), 8);

  // Conservation: everything that entered "applied" left it.
  assert.equal(
    flow("applied", "rejected") + flow("applied", "ghosted") + flow("applied", "first_round"),
    node("applied")
  );

  // And out of the first round.
  assert.equal(
    flow("first_round", "rejected") + flow("first_round", "second_round") + flow("first_round", "withdrawn"),
    node("first_round")
  );

  const s = pipelineSummary(p);
  assert.equal(s.offers, 1);
  assert.equal(s.advanced, 12);
  assert.equal(s.pending, 0);

});


test("a response rate with nothing to divide is null, not zero", () => {

  const empty = pipelineSummary({ applications: 0, nodes: [], flows: [] });

  assert.equal(empty.responseRate, null, "a rate computed from no data is not a rate");

});


test("ghosted is derived, so it can never be recorded by hand", () => {

  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /stage === "ghosted"/);
  assert.match(jobs, /Not a recordable stage/);

  // Every stage the UI offers must be a real one.
  const list = read("web/app/ApplicationList.js");
  for (const stage of ["first_round", "second_round", "final_round", "offer", "rejected", "withdrawn"]) {
    assert.ok(STAGES[stage], `${stage} is offered by the UI but is not a stage`);
    assert.match(list, new RegExp(stage));
  }

});


test("notifications are rate-limited, and nothing is ever dropped", () => {

  const jobs = read("web/tools/jobs.js");

  // Blake's framing: twenty postings across a day is good news; ten in five
  // minutes is what gets an app muted. So the limit is on rate.
  assert.match(jobs, /PUSH_WINDOW_MINUTES/);
  assert.match(jobs, /PUSH_BUDGET/);

  // The rate check must come BEFORE the claim. Claiming and then declining to
  // send marks postings as announced when they never were.
  const check = jobs.slice(jobs.indexOf("export async function checkForNewJobs"));
  const budget = check.indexOf("pushBudgetRemaining()");
  const claim = check.indexOf("notified_at: new Date().toISOString()");
  assert.ok(budget > 0 && budget < claim, "rate must be checked before notified_at is claimed");

  // Deferred, not dropped.
  assert.match(check, /deferred: result\.fresh\.length/);

});


test("the weekly digest counts in code and needs no new schedule", () => {

  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /weeklyJobDigest/);
  assert.match(jobs, /now\.weekday !== 7/, "it decides for itself that it is Sunday");

  // It rides the hourly job rather than owning a clock — this codebase has
  // already had one scheduler stop silently.
  assert.match(read("web/app/api/cron/[job]/handler.js"), /weeklyJobDigest/);

});
