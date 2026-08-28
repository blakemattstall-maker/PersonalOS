import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { orgMatches } from "../web/tools/workLog.js";
import { overlapsExisting } from "../web/tools/triggers.js";


// Two failures on one evening, both of which looked like the app losing data
// and neither of which was.


const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function fn(source, name) {
  const start = source.indexOf(name);
  assert.ok(start !== -1, `${name} is gone — this test is not reading what it thinks`);
  const after = source.slice(start + name.length);
  const next = after.search(/\nexport (async )?function |\nasync function |\nfunction /);
  return next === -1 ? after : after.slice(0, next);
}


// ── one event, four notifications ────────────────────────────────────────

test("a second reminder covering the same events is refused", () => {

  // "Redbird media capture" matching "Redbird Barbell" was created alongside
  // "Barbell — film it" matching "barbell" — a strict superset of the same
  // event. Both fired. Saying the same standing wish twice bought a second
  // notification forever.
  const existing = [
    { kind: "before_event", event_match: "barbell", active: true },
    { kind: "place_arrival", place_id: "gym-uuid", active: true }
  ];

  assert.equal(overlapsExisting(existing, { kind: "before_event", event_match: "Redbird Barbell" }), true);
  assert.equal(overlapsExisting(existing, { kind: "before_event", event_match: "barbell" }), true);
  assert.equal(overlapsExisting(existing, { kind: "place_arrival", place_id: "gym-uuid" }), true);

  // Genuinely different rules still get through.
  assert.equal(overlapsExisting(existing, { kind: "before_event", event_match: "dentist" }), false);
  assert.equal(overlapsExisting(existing, { kind: "place_arrival", place_id: "library-uuid" }), false);
  assert.equal(overlapsExisting(existing, { kind: "time_of_day", at_time: "21:00" }), false);

  // An inactive one is not cover.
  assert.equal(
    overlapsExisting([{ kind: "before_event", event_match: "barbell", active: false }],
      { kind: "before_event", event_match: "barbell" }),
    false
  );

});


test("the cooldown guards the gap the unique key cannot", () => {

  // The key stops one OCCASION firing twice and does nothing about several
  // occasions in a row. One barbell meeting was on the calendar three times —
  // "Barbell meeting", "Meet early @ barbell", "Redbird Barbell club meeting" —
  // three distinct Google ids, three legitimate occasions, three pushes.
  const triggers = read("web/tools/triggers.js");

  const fire = fn(triggers, "export async function fireTrigger(");

  assert.match(fire, /cooldown_minutes \?\? 360/);
  assert.match(fire, /skipped: "within cooldown"/);

  // Before the claim, deliberately: consuming the key inside the cooldown would
  // mark the occasion fired without firing it, and swallow the real one later
  // in the window.
  const cooldownAt = fire.indexOf("within cooldown");
  const claimAt = fire.indexOf("await claim(");

  assert.ok(cooldownAt > 0 && claimAt > cooldownAt, "the cooldown must be checked before the key is consumed");

});


test("a one-off errand cannot become a standing reminder", () => {

  // "I have a calendar event tomorrow at noon to pick up my package" armed a
  // before_event trigger matching "pick up" — which would fire on every future
  // event containing those two words.
  const extract = read("web/tools/extract.js");

  assert.match(extract, /const GENERIC_MATCHES = new Set\(/);
  assert.match(extract, /GENERIC_MATCHES\.has\(match\.toLowerCase\(\)\)/);

  for (const word of ["pick up", "meeting", "class", "shift", "deadline"]) {
    assert.ok(extract.includes(`"${word}"`), `"${word}" is too generic to be a calendar rule`);
  }

  assert.match(extract, /A TRIGGER IS A STANDING RULE, NOT A ONE-OFF/);

});


// ── "I don't have any recorded work" ─────────────────────────────────────

test("an employer is recognised however he says its name", () => {

  // He will not say the same name twice. A log that only answers to its own
  // exact spelling is a log that looks empty.
  assert.equal(orgMatches("Redbird Creative", "Redbird Creative"), true);
  assert.equal(orgMatches("Redbird Creative", "redbird creative"), true);
  assert.equal(orgMatches("Redbird Creative", "Redbird"), true);
  assert.equal(orgMatches("Redbird Creative", "Redbird Athletics"), true);
  assert.equal(orgMatches("Redbird Creative", "my redbird job"), true);

  // But not everything.
  assert.equal(orgMatches("Redbird Creative", "Trifilm"), false);
  assert.equal(orgMatches("Redbird Creative", ""), false);
  assert.equal(orgMatches("", "Redbird"), false);

  // Short words must not bridge two unrelated employers.
  assert.equal(orgMatches("The Home Depot", "The Gap"), false);

});


test("the log is read whole, never as a relevant sample", () => {

  // This is the difference from memories, and the reason the table exists.
  // Retrieval by similarity returns the highest-scoring handful; "everything I
  // did this semester" has to return everything.
  const workLog = read("web/tools/workLog.js");

  assert.match(workLog, /selectAll\(/, "PostgREST caps a plain select at 1000 rows and says nothing");

  const entries = fn(workLog, "export async function entriesFor(");

  assert.match(entries, /ascending: true/, "oldest first — the order is the point");

  assert.doesNotMatch(entries, /\.limit\(/, "a limit here silently truncates the record");

});


test("totals are counted in code and handed to the model as facts", () => {

  const workLog = read("web/tools/workLog.js");

  const summarise = fn(workLog, "export async function summariseWork(");

  assert.match(summarise, /totals\[unit\] = \(totals\[unit\] \|\| 0\) \+ value/,
    "15 GIFs one day and 12 the next is 27, and that is arithmetic");

  const answer = fn(workLog, "export async function answerWorkQuestion(");

  assert.match(answer, /use these exactly/i);
  assert.match(answer, /never compute or/i);

});


test("a work question routes to the log, not to personal projects", () => {

  // The whole reported bug: the work WAS saved, and the question went to
  // query_projects, which reads the projects table and cannot see it.
  const defs = read("web/lib/toolDefinitions.js");

  const queryWork = defs.slice(defs.indexOf('name: "query_work"'), defs.indexOf('name: "query_people"'));

  assert.ok(queryWork.length > 100, "query_work is not defined");
  assert.match(queryWork, /NOT query_projects/,
    "the description has to say which tool loses, or the router keeps choosing the old one");

  const router = read("web/lib/router.js");
  assert.match(router, /case "query_work":/);
  assert.match(router, /case "log_work":/);

  // And it needs his exact words, like the other answering tools.
  assert.match(
    read("web/app/api/capture/handler.js"),
    /toolName === "query_work"/,
    "a paraphrase loses the employer name the log is looked up by"
  );

});


test("logging work never rewrites what he said", () => {

  // The detail IS the value. A model that compresses it is deleting the thing
  // being stored.
  const defs = read("web/lib/toolDefinitions.js");

  const logWork = defs.slice(defs.indexOf('name: "log_work"'), defs.indexOf('name: "query_work"'));

  assert.match(logWork, /Do not summarise, do not shorten/);
  assert.match(logWork, /Include every number he said/);

});


test("the work log reaches every reasoning surface", () => {

  // Without this the brief and the nudge writer keep saying he has no record of
  // a job he has been logging for weeks — the same failure as the empty
  // projects table blanking the Projects line.
  const signals = read("web/lib/signals.js");

  assert.match(signals, /workSignal\(\)/);
  assert.match(signals, /work && `Work logged: \$\{work\}`/);

});
