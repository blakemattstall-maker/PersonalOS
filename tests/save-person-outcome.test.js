import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mergeNote } from "../web/tools/people.js";


// What savePerson does to a person who already exists.
//
// The bug that opened this file: a capture said "Cooper mentioned there may be
// a video job up in Schaumburg for $1500", and three separate things went
// wrong at once.
//
//   1. The function threw "taskResult is not defined" from its return
//      statement — an identifier a rename had left behind. The throw landed
//      AFTER the Supabase write, so the shortcut announced a failure that had
//      already succeeded. Twice, because a failure that isn't real repeats
//      identically when you retry it.
//
//   2. The note replaced "We split VATHOS 50/50." instead of joining it. A
//      sentence about a job deleted the fact that Cooper is a co-founder.
//
//   3. The model had filled in relationship: "contact" — a field the user
//      never mentioned — and "VATHOS co-founder" was overwritten in silence.
//
// (1) is guarded by tests/no-undefined-identifiers.test.js, which runs eslint's
// no-undef over the whole codebase. (2) and (3) are here.


const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const peopleSource = read("web/tools/people.js");
const toolDefs = read("web/lib/toolDefinitions.js");


// --- notes accumulate ----------------------------------------------------

test("a new note is added to the old one, not written over it", () => {

  assert.equal(
    mergeNote("We split VATHOS 50/50.", "Mentioned a video job in Schaumburg for $1500."),
    "We split VATHOS 50/50.\nMentioned a video job in Schaumburg for $1500."
  );

});


test("the same fact said twice is stored once", () => {

  // The model routinely restates the standing note alongside the new one.
  // Appending blindly would double the line on every save.
  const had = "We split VATHOS 50/50.";

  assert.equal(mergeNote(had, had), had);
  assert.equal(mergeNote(`${had}\nHe lives in Chicago.`, had), `${had}\nHe lives in Chicago.`);

});


test("nothing on either side is handled without inventing text", () => {

  assert.equal(mergeNote(null, "First thing known about them."), "First thing known about them.");
  assert.equal(mergeNote("Already known.", ""), "Already known.");
  assert.equal(mergeNote("Already known.", null), "Already known.");
  assert.equal(mergeNote(null, null), null);
  assert.equal(mergeNote("", ""), null);

});


test("whitespace never becomes a note", () => {

  assert.equal(mergeNote("Already known.", "   \n  "), "Already known.");
  assert.equal(mergeNote("  Already known.  ", "New."), "Already known.\nNew.");

});


// --- and only on the path that can't distinguish the two -----------------

test("merging happens on the voice path and replacement on the form path", () => {

  // The edit form carries an id and shows the current text in the box, so what
  // is in the box IS the note and blanking it means blank. Voice has no id and
  // no view of what is stored, so its note can only ever be an addition.
  assert.match(
    peopleSource,
    /const mergedNotes = !id && existing\?\.notes && provided\(notes\) && notes/,
    "the merge must be gated on the absence of an id"
  );

  assert.match(
    peopleSource,
    /notes: mergedNotes \|\| notes \|\| null/,
    "and it must fall back to plain replacement when there is nothing to merge"
  );

});


test("a re-filing is said out loud, because a relationship cannot accumulate", () => {

  // notes can hold both facts; relationship is one string. So the one thing
  // that can be done about a silent overwrite is to stop it being silent.
  assert.match(
    peopleSource,
    /const refiled = !id && relationship && existing\?\.relationship && existing\.relationship !== relationship/
  );

  assert.match(
    peopleSource,
    /Filed under "\$\{relationship\}" now instead of "\$\{refiled\}"/,
    "the old value has to appear in the reply or the change is invisible"
  );

});


test("the model is told not to guess a relationship in the first place", () => {

  // The real origin of the lost value: save_person's schema described
  // relationship without ever saying to omit it, so the model supplied
  // "contact" for a sentence that said nothing about how they know each other.
  // Every other optional field on this tool already carries that instruction.
  const schema = toolDefs.slice(
    toolDefs.indexOf('name: "save_person"'),
    toolDefs.indexOf('name: "query_people"')
  );

  assert.ok(schema.length > 200, "could not find the save_person tool definition");

  const relationship = schema.match(/relationship: \{ type: "string", description: "([^"]+)"/);

  assert.ok(relationship, "save_person no longer describes relationship");
  assert.match(relationship[1], /ONLY if|Omit/, "it must tell the model when NOT to send this");
  assert.match(relationship[1], /never fill in a generic|Never guess/i);

});


// --- the return value ----------------------------------------------------

test("savePerson reports the calendar event it actually made", () => {

  // The field this replaced read `taskResult?.data`, and upsertYearlyAllDayEvent
  // has never returned a `data` key — so even before the identifier went
  // missing, the value was null on every successful save. Two bugs stacked in
  // one expression: one that threw, and one that lied quietly underneath it.
  assert.match(
    peopleSource,
    /data: \{ person, calendarEvent: dateEventResult\?\.id \|\| null, staggerOffset \}/
  );

  // The prose above mentions the old name deliberately, so this looks for the
  // dereference rather than the word. no-undef is the real guard either way.
  assert.ok(
    !/taskResult\?\./.test(peopleSource),
    "taskResult is being read again"
  );

});


test("the calendar event id is a real key of what syncImportantDateEvent returns", () => {

  // Guards against replacing one made-up property with another. The shape is
  // set by upsertYearlyAllDayEvent, so read it there.
  const calendar = read("web/tools/googleCalendar.js");

  const body = calendar.slice(calendar.indexOf("export async function upsertYearlyAllDayEvent"));

  assert.match(body.slice(0, 3000), /return \{ success: true, created: true, id: res\.data\.id \}/);
  assert.match(body.slice(0, 3000), /return \{ success: true, existed: true, id: eventId \}/);
  assert.match(body.slice(0, 3000), /return \{ success: true, updated: true, id: eventId \}/);

});
