import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseNumbers } from "../web/tools/triggers.js";


// The app doing things itself, at the moment they matter.
//
// It told its owner to "Add a 4:30pm Google Calendar notification today: bring
// your phone, capture media and stats" — while a memory saying exactly that
// sat in the database, and while the app could already create calendar events,
// knew where he was to a hundred metres, and pinged every ten minutes. The
// assistant asked the person to go and set up the assistant.
//
// A trigger is WHEN this happens, SAY this, and optionally ASK for something
// back and keep the answers. Nothing in the engine knows about gyms or
// barbells — the same three columns have to serve whatever is asked for next,
// which is the part these tests exist to hold.


const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const triggers = read("web/tools/triggers.js");
const location = read("web/tools/location.js");
const extract = read("web/tools/extract.js");


function fn(source, name) {
  const start = source.indexOf(name);
  assert.ok(start !== -1, `${name} is gone — this test is not reading what it thinks`);
  const after = source.slice(start + name.length);
  const next = after.search(/\nexport (async )?function |\nasync function |\nfunction /);
  return next === -1 ? after : after.slice(0, next);
}


// --- numbers, measured rather than remembered ----------------------------

test("what he types becomes numbers a chart can be drawn from", () => {

  assert.deepEqual(parseNumbers("5 negatives, 2 assisted"), { negatives: 5, assisted: 2 });
  assert.deepEqual(parseNumbers("got 8 pull ups today"), { pull_ups: 8 });
  assert.deepEqual(parseNumbers("12 pull-ups"), { pull_ups: 12 });

});


test("pull ups and pull-ups are one series, not two", () => {

  // Two spellings of one exercise would otherwise split the progress line in
  // half and make both halves look like nothing is happening.
  const spaced = parseNumbers("7 pull ups");
  const hyphen = parseNumbers("7 pull-ups");

  assert.deepEqual(Object.keys(spaced), Object.keys(hyphen));

});


test("a bare number answers the question that was asked", () => {

  assert.deepEqual(parseNumbers("7"), { count: 7 });
  assert.deepEqual(parseNumbers("  3  "), { count: 3 });

});


test("nothing countable yields null rather than a fake zero", () => {

  assert.equal(parseNumbers("felt terrible, skipped it"), null);
  assert.equal(parseNumbers(""), null);
  assert.equal(parseNumbers(null), null);
  assert.equal(parseNumbers(undefined), null);

});


test("the first mention of a unit wins", () => {

  // "3 sets of 5 reps" must not have the later number overwrite the earlier
  // count of the same thing.
  const parsed = parseNumbers("3 sets of 5 reps");

  assert.equal(parsed.sets, 3);
  assert.equal(parsed.reps, 5);

});


test("a stripped conjunction never becomes a unit", () => {

  const parsed = parseNumbers("4 and then some");

  assert.ok(!("and" in parsed), "'and' is not a unit");

});


// --- the lock ------------------------------------------------------------

test("firing is locked by a unique insert, never by a timestamp comparison", () => {

  // A cooldown is wrong in both directions for anything calendar-driven: two
  // events matching one word inside a window silently drop the second, and a
  // window short enough to allow both lets one event fire twice across two
  // cron ticks. And a read-then-write on a timestamp is not a lock at all —
  // two concurrent runs both read the old value and both proceed.
  const claim = fn(triggers, "async function claim(");

  assert.match(claim, /from\("trigger_fires"\)\s*\n?\s*\.insert/,
    "the claim must be an insert against the unique index");

  assert.match(claim, /23505|duplicate key/,
    "a unique violation is the expected outcome, not an error to report");

  assert.doesNotMatch(claim, /last_fired_at\.lt\./,
    "a timestamp comparison is not a lock");

});


test("nothing can fire without naming the occasion it is firing for", () => {

  const fire = fn(triggers, "export async function fireTrigger(");

  assert.match(fire, /if \(!fireKey\) throw/,
    "a missing fireKey must fail loudly — silently firing unlocked is the bug this replaces");

  const claimAt = fire.indexOf("await claim(");
  const cardAt = fire.indexOf('from("prompts")');
  const pushAt = fire.indexOf("sendPush(");

  assert.ok(claimAt > 0 && cardAt > claimAt, "the claim comes before the card");
  assert.ok(pushAt > cardAt, "and the card before the push");

});


test("every kind names its occasion in a way that repeats exactly once", () => {

  // place: once per VISIT, so walking past tomorrow is a new occasion and no
  // cooldown has to be guessed at.
  assert.match(triggers, /fireKey: `place:\$\{place\.id\}:\$\{place\.arrived_at\}`/);

  // event: Google expands recurring events with singleEvents, so every
  // Wednesday's meeting is its own id — and two different events matching the
  // same word on one day never collide.
  assert.match(triggers, /fireKey: `event:\$\{event\.id\}`/);

  // time: once per local day.
  assert.match(triggers, /fireKey: `time:\$\{now\.toISODate\(\)\}:\$\{trigger\.at_time\}`/);

});


test("the card is written whatever the interruption level says", () => {

  const fire = fn(triggers, "export async function fireTrigger(");

  const cardAt = fire.indexOf('from("prompts")');
  const gateAt = fire.indexOf("pushAllowed(");

  assert.ok(cardAt > 0 && gateAt > cardAt,
    "turning the dial down means stop interrupting me, never stop keeping track");

  assert.match(fire, /pushAllowed\("check_in"\)/);

  // An urgency missing from URGENCY_TIERS falls back to the most restrictive
  // tier and silently never pushes.
  assert.match(read("web/lib/settings.js"), /check_in: "digest_plus_urgent"/);

});


// --- being somewhere -----------------------------------------------------

test("presence is measured on its own clock, not the visit clock", () => {

  // Three hours is right for counting visits and useless for measuring
  // presence: under it, a walk past the gym at 8:00 and another at 8:20 read
  // as twenty unbroken minutes of training.
  assert.match(location, /const PRESENCE_BREAK_MINUTES = \d+/);

  const gap = Number(location.match(/const PRESENCE_BREAK_MINUTES = (\d+)/)[1]);

  assert.ok(gap >= 20 && gap <= 45, `a presence break of ${gap} minutes is not two ping cadences`);

  assert.match(location, /restartsPresence = isNewVisit \|\| gapMinutes >= PRESENCE_BREAK_MINUTES/);

});


test("a batch fires once per place, not once per ping", () => {

  // Overland posts batches; a measured 50-point delivery takes ~16 seconds and
  // a per-point call would multiply two more queries by fifty AND replay old
  // arrivals as live pushes.
  const ingest = fn(location, "export async function ingestLocationPoints(");

  const collect = ingest.indexOf("touched.add(place.id)");
  const loopEnd = ingest.indexOf("runPlaceTriggers(");

  assert.ok(collect > 0, "places touched by the batch must be collected");
  assert.ok(loopEnd > collect, "and acted on after the loop, once");

  assert.equal(
    (ingest.match(/runPlaceTriggers\(/g) || []).length, 1,
    "exactly one call, outside the per-point loop"
  );

});


test("dwell is re-checked while he stays, not only when he arrives", () => {

  // The obvious version — fire only on isNewVisit — breaks every trigger with
  // a dwell, which is the gym case. On the arriving ping dwell is zero.
  const run = fn(triggers, "export async function runPlaceTriggers(");

  assert.match(run, /dwelt < \(trigger\.dwell_minutes \|\| 0\)/);
  assert.match(run, /sinceSeen > STILL_HERE_MINUTES/,
    "and a place he has left must not fire at all");

});


test("a place whose row would not write is excluded from firing", () => {

  // That write became load-bearing the moment a trigger read arrived_at from
  // it. Deciding from stale values is a notification about a room he is not in.
  assert.match(location, /const \{ error: placeError \}/);
  assert.match(location, /failedPlaces\.add\(place\.id\)/);
  assert.match(location, /filter\(id => !failedPlaces\.has\(id\)\)/);

});


test("the ingest reports what the triggers did, so a dead one is visible", () => {

  // The handler logs this return object into activity_logs verbatim, and the
  // diagnostics panel renders it. Without it, "checked 2, fired 0" and "this
  // has not run since Tuesday" look identical.
  assert.match(location, /triggersChecked,/);
  assert.match(location, /triggersFired,/);

});


// --- a calendar occasion -------------------------------------------------

test("an all-day event can never drive a lead time", () => {

  // An all-day event is a bare date. Parsed in the runtime zone — UTC on
  // Vercel — "30 minutes before" lands at 6:30pm the previous day in Chicago.
  const run = fn(triggers, "export async function runEventTriggers(");

  assert.match(run, /filter\(e => !e\.allDay && e\.start\)/);

});


test("the event window is wider than the scheduler's tick", () => {

  // A moment-equality test silently drops firings whenever a tick is late, and
  // the measured drift on this account is 30-50 minutes for the daily crons.
  const run = fn(triggers, "export async function runEventTriggers(");

  assert.match(run, /minutesPastTarget < 0/, "never before the target");
  assert.match(run, /EVENT_WINDOW_MINUTES/, "but forgiving after it");
  assert.match(run, /if \(now > start\) continue/, "and never after the event has begun");

});


test("a dead Google token degrades the calendar half only", () => {

  const run = fn(triggers, "export async function runEventTriggers(");

  assert.match(run, /catch \(error\)/);
  assert.match(run, /calendar unavailable/);

  // And the cron keeps the two halves apart, so a dead token cannot stop a
  // time-of-day reminder that needs no calendar at all.
  const cron = read("web/app/api/cron/[job]/handler.js");

  assert.match(cron, /runEventTriggers\(\)\.catch/);
  assert.match(cron, /runTimeTriggers\(\)\.catch/);

});


test("the trigger sweep does not ride the job poller", () => {

  const cron = read("web/app/api/cron/[job]/handler.js");

  // Folded into checkJobs, a throw would 500 the cron route, fail the GitHub
  // workflow's curl assertion, and take the internship poll red every fifteen
  // minutes.
  assert.match(cron, /^\s*runTriggers,$/m, "runTriggers must be its own registered job");

  const checkJobs = fn(cron, "async function checkJobs(");

  assert.doesNotMatch(checkJobs, /runEventTriggers|runTimeTriggers/);

  // Daily Vercel crons drift 30-50 minutes on this account, which cannot carry
  // a promise about a moment.
  assert.match(read("docs/cron-triggers.sql"), /\*\/5 \* \* \* \*/);
  assert.match(read("docs/cron-triggers.sql"), /runTriggers/);

});


// --- the answer coming back ----------------------------------------------

test("a check-in can actually be answered", () => {

  // relationship_checkin proves this is not hypothetical: it shipped with a
  // server-side recorder expecting a typed reply and was never added to the
  // card's answerable list, so for its whole life it rendered a dismiss button
  // that submitted the literal string "dismissed" into a function built to
  // read a real answer.
  const card = read("web/app/PromptCard.js");

  assert.match(card, /const ANSWERABLE = \{/);

  for (const kind of ["label_place", "relationship_checkin", "check_in"]) {
    assert.ok(card.includes(`${kind}: {`), `${kind} must be answerable`);
  }

  // kind is overwritten with "prompt" for card dispatch; promptKind is the only
  // surviving signal, so a branch on item.kind would be dead code.
  assert.match(card, /promptKind === "check_in"/);
  assert.doesNotMatch(card, /item\.kind === "check_in"/);

});


test("nothing about the input still says 'name this place'", () => {

  const card = read("web/app/PromptCard.js");

  // A screen reader announcing "Name this place" when the question is "how
  // many did you get?" is the same bug as showing the wrong button.
  assert.match(card, /placeholder=\{field\.placeholder\}/);
  assert.match(card, /aria-label=\{field\.aria\}/);
  assert.match(card, /\{isPending \? "Saving…" : field\.action\}/);

});


test("a check-in is dismissible without lying about it", () => {

  const card = read("web/app/PromptCard.js");

  // Standing at the gym having done none of it is a real answer, and a card
  // whose only exit is a number is a card that gets ignored.
  assert.match(card, /promptKind === "check_in" && !saved/);
  assert.match(card, /Not today/);

});


test("the recorder's reply is shown rather than thrown away", () => {

  const card = read("web/app/PromptCard.js");

  // "Logged. 7 pull ups — best 7, up 2 from your first" is the progress he
  // asked to be tracked, and the moment to show it is the moment he types.
  assert.match(card, /setSaved\(result\.message\)/);
  assert.match(card, /\{saved\}/);

});


test("a dismissed check-in still routes to the recorder", () => {

  const handler = read("web/app/api/[resource]/handler.js");

  const branch = handler.slice(
    handler.indexOf('prompt?.kind === "check_in"'),
    handler.indexOf('prompt?.kind === "stale_review"')
  );

  assert.ok(branch.length > 40, "the check_in branch is gone");

  // label_place guards on answer !== "dismissed" so a dismissal is not written
  // as the label. That is wrong here: the recorder is what knows the
  // difference, and a dismissal is data about whether the reminder earns its
  // place.
  assert.doesNotMatch(branch, /answer !== "dismissed"/);

  assert.match(branch, /recordTriggerResponse/);

});


// --- what a capture keeps ------------------------------------------------

test("extraction runs on every exit from the capture handler", () => {

  const handler = read("web/app/api/capture/handler.js");

  // Three paths return, not one — the resumed clarification, the no-tool-call
  // conversational answer, and the tool loop. The utterance that exposed the
  // whole gap took the middle one, so a pass bolted onto the end of the tool
  // loop would have missed exactly the case it was written for.
  assert.equal(
    (handler.match(/withExtraction\(/g) || []).length,
    4,
    "one helper definition and three call sites"
  );

});


test("extraction never files a card and never breaks the reply", () => {

  const handler = read("web/app/api/capture/handler.js");

  // lib/captureNotify.js owns filing. Two places filing the same thing is a
  // bug this codebase has already had, and a test already forbids the handler
  // from inserting prompt rows.
  assert.doesNotMatch(handler, /from\("prompts"\)\.insert/);

  // result.message is a hard contract: the desk firmware and the Action Button
  // Shortcut both read it aloud. Extraction appends to it rather than adding a
  // result, which would also make "2 things done" say three.
  assert.match(read("web/tools/extract.js"), /return null;/);
  assert.doesNotMatch(extract, /throw new Error/);

});


test("a project is not created four times for one thing said four times", () => {

  // createProject is a bare insert and lib/dedupe.js is hardcoded to a
  // `content` column, while a project's text lives in `name`. So this file
  // carries its own check, and the comment says so rather than claiming an
  // inheritance that does not exist.
  assert.match(extract, /function alreadyHaveProject\(/);
  assert.match(extract, /have\.includes\(wanted\) \|\| wanted\.includes\(have\)/);
  assert.match(extract, /alreadyHaveProject\(existingProjects, project\.name\)/);

});


test("a trigger the model invents is validated in code before it is stored", () => {

  // Every field that decides behaviour is checked here rather than trusted. A
  // place_arrival row with a null place_id can never fire and would sit in the
  // list looking like it works.
  const resolve = fn(extract, "async function resolveTrigger(");

  assert.match(resolve, /\["place_arrival", "before_event", "time_of_day"\]\.includes\(kind\)/);
  assert.match(resolve, /if \(!place\) return null/);
  assert.match(resolve, /if \(!at\) return null/);

});


test("extraction leaves a heartbeat whether or not it found anything", () => {

  // A pass that quietly stops finding things looks exactly like a quiet week.
  assert.match(extract, /action: "capture_extract"/);

  const successes = extract.match(/action: "capture_extract"/g) || [];

  assert.ok(successes.length >= 3, "logged on success, on unparseable JSON, and on failure");

});


// --- the rule that started all of this -----------------------------------

test("no nudge writer may tell him to do what the app can do itself", () => {

  const nudges = read("web/tools/nudges.js");

  assert.match(nudges, /NEVER TELL HIM TO DO SOMETHING THIS APP CAN DO ITSELF/);

  // Both prompts. chooseWhatToSend does not merely select — it REWRITES, and
  // is told to keep "every concrete action from the ones you dropped", so a
  // rule living only in the writer gets laundered straight back in.
  const writer = nudges.indexOf("AUTONOMY_RULE = ");
  const rewriter = nudges.indexOf("${AUTONOMY_RULE}");

  assert.ok(writer > 0 && rewriter > writer, "the merger has to carry the rule too");

  // And accountability.js is a second, independent nudge writer on the same
  // delivery path.
  assert.match(read("web/tools/accountability.js"), /Never tell him to set up a reminder/);

});
