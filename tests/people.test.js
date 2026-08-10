import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const peopleSource = read("web/tools/people.js");
const formSource = read("web/app/AddPersonForm.js");
const cardSource = read("web/app/PersonCard.js");
const buttonSource = read("web/app/GraphButton.js");
const layoutSource = read("web/app/layout.js");


// ---------------------------------------------------------------------------
// Editing a person. The semantics here carry two different callers with two
// different vocabularies, and flattening them breaks one silently.
// ---------------------------------------------------------------------------

test("an edit is looked up by id, so a rename cannot fork a person", () => {

  // savePerson matched by name only, which meant a corrected name could never
  // match its own typo — fixing "Jon Rider" to "Jon Ryder" created a second
  // person and left the misspelt one holding all the history.
  const body = peopleSource.slice(
    peopleSource.indexOf("export async function savePerson"),
    peopleSource.indexOf("let taskResult")
  );

  assert.match(
    body,
    /id \? await findPersonById\(id\) : await findPersonByName\(name\)/,
    "an id must win over a name match"
  );

});


test("an id pointing at a deleted row is an error, not a resurrection", () => {

  // Falling through to the insert branch would recreate a deleted person from
  // whatever the form still held.
  const body = peopleSource.slice(peopleSource.indexOf("export async function savePerson"));

  assert.match(body.slice(0, 2600), /if \(id && !existing\)/);
  assert.match(body.slice(0, 2600), /no longer exists/);

});


test("null leaves a field alone; empty string clears it", () => {

  // Two callers, two vocabularies of absence. Voice sends null for fields it
  // didn't mention — "add Sam's email" must not wipe his phone. The edit form
  // sends "" for a blanked field, because in a form showing every current
  // value, blank IS the statement. Under the old `!== null` spread alone, a
  // phone number silently survived its own deletion.
  const body = peopleSource.slice(
    peopleSource.indexOf("export async function savePerson"),
    peopleSource.indexOf("let taskResult")
  );

  assert.match(body, /provided\(phone\) && \{ phone: phone \|\| null \}/,
    "a provided-but-empty value must be stored as null");

  assert.match(peopleSource, /const provided = \(value\) => value !== null && value !== undefined/,
    "and null/undefined must still mean not-mentioned");

});


test("clearing the check-in cadence also clears the nudge already on the clock", () => {

  // Without this, "don't remind me" saves and the previously scheduled
  // next_check_in_at still fires — a setting that visibly doesn't work.
  const body = peopleSource.slice(peopleSource.indexOf("export async function savePerson"));

  assert.match(body, /check_in_days === 0/);
  assert.match(body, /patch\.next_check_in_at = null/);

});


test("the form sends clear-values only when editing", () => {

  // Add mode must keep the voice vocabulary (null = not mentioned): the add
  // form's blank fields are things never said, not deletions of them.
  assert.match(formSource, /const cleared = editing \? "" : null/);
  assert.match(formSource, /const clearedNumber = editing \? 0 : null/);
  assert.match(formSource, /\.\.\.\(editing && \{ id: person\.id \}\)/, "and the id rides only on edits");

});


test("the person card can actually open the editor", () => {

  assert.match(cardSource, /setEditing\(true\)/, "there must be an edit affordance");
  assert.match(cardSource, /<AddPersonForm/, "and it must reuse the one form");
  assert.match(cardSource, /router\.refresh\(\)/,
    "a finished edit must refetch — the card shows server data, and without this the save looks ignored");

});


// ---------------------------------------------------------------------------
// The graph's unconditional door.
// ---------------------------------------------------------------------------

test("the graph button is on every signed-in page and no signed-out one", () => {

  // The card links into /graph are real but conditional — no active project
  // and no pending insight meant no way into the page at all. This button is
  // the unconditional entry, so it has to be mounted globally and obey the
  // same signed-out rule as the TabBar.
  assert.match(layoutSource, /<GraphButton \/>/, "it must be mounted in the root layout");

  assert.match(
    buttonSource,
    /pathname === "\/login" \|\| pathname === "\/welcome"/,
    "and hidden exactly where the TabBar hides"
  );

});


test("the graph button is a real link with a real touch target", () => {

  assert.match(buttonSource, /href="\/graph"/);
  assert.match(buttonSource, /aria-label="Connections"/, "an icon-only control needs a name");
  assert.match(buttonSource, /h-11 w-11/, "44px is the floor for a touch target");

});
