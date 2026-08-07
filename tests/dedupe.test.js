import test from "node:test";
import assert from "node:assert/strict";

import { normalise } from "../web/lib/dedupe.js";


// The free, offline half of duplicate detection.
//
// This is the path that catches the case that actually prompted the feature —
// running the Shortcut twice by accident — and it must never depend on a model
// call, because that would make the common case both slow and non-deterministic.
// The semantic half is genuinely fuzzy and is tested by running it, not here.


test("normalise collapses the wordings the same fact actually arrives in", () => {

  const forms = [
    "The user's university ID number is 813860967.",
    "User's university ID number is 813860967.",
    "user university id number is 813860967",
    "The University ID number is 813860967!"
  ];

  const normalised = forms.map(normalise);

  // Every one of these was, or could plausibly have been, written by a
  // different capture path for the same fact.
  for (const n of normalised) {
    assert.equal(n, normalised[0], `"${n}" should match "${normalised[0]}"`);
  }

});


test("first-person and third-person phrasings of one fact collapse together", () => {

  // The router writes "User prefers X"; a deep-thinking turn writes "I prefer
  // X". Same fact, two doors, and both doors are used in practice.
  assert.equal(
    normalise("I prefer evening workouts"),
    normalise("User prefers evening workouts").replace("prefers", "prefer")
  );

  assert.equal(
    normalise("My goal weight is 185 lbs"),
    normalise("The user's goal weight is 185 lbs")
  );

});


test("normalise handles surface form only — verb agreement is the model's job", () => {

  // Documented limit, not an oversight. "I am cutting" and "User is cutting"
  // differ by a conjugated verb, and stripping common verbs to fix that would
  // start collapsing genuinely different facts. The free path deliberately
  // stops here; anything subtler goes to the classifier, which gets these
  // right (verified against the live table).
  assert.notEqual(
    normalise("I am cutting and goal weight is 185 lbs"),
    normalise("User is cutting and goal weight is 185 lbs")
  );

  // But it must at least not leave debris behind when stripping "i am" —
  // an earlier version matched "i" first and left a stray "am".
  assert.doesNotMatch(normalise("I am cutting"), /\bam\b/);

});


test("normalise does NOT collapse genuinely different facts", () => {

  // The dangerous failure is over-normalising: two real facts becoming one and
  // silently losing information.
  assert.notEqual(
    normalise("My gate code is 4417"),
    normalise("My gate code is 4418")
  );

  assert.notEqual(
    normalise("I prefer evening workouts"),
    normalise("I prefer morning workouts")
  );

  assert.notEqual(
    normalise("Sarah is my roommate"),
    normalise("Sarah is my sister")
  );

});


test("normalise is stable on empty and junk input", () => {

  // saveNote guards against empty content, but normalise is also called on
  // whatever is already in the table, which predates any guard.
  assert.equal(normalise(""), "");
  assert.equal(normalise(null), "");
  assert.equal(normalise(undefined), "");
  assert.equal(normalise("   ...   "), "");

});


test("curly and straight apostrophes are the same fact", () => {

  // iOS substitutes curly quotes when dictating; typing in a browser does not.
  // Two captures of one sentence would otherwise never match.
  assert.equal(
    normalise("I don't want bad news softened"),
    normalise("I don’t want bad news softened")
  );

});


// ---------------------------------------------------------------------------
// Audio upload filenames
// ---------------------------------------------------------------------------

import { extensionFor } from "../web/tools/pitch.js";


test("iOS Shortcut recordings get a filename OpenAI will accept", () => {

  // The whole point. iOS's Record Audio action reports audio/m4a, and an
  // earlier substring check for "mp4" did not match it — so every voice
  // capture from the phone would have been uploaded as .webm and rejected as
  // corrupt, with an error that says nothing about filenames.
  assert.equal(extensionFor("audio/m4a"), "m4a");
  assert.equal(extensionFor("audio/x-m4a"), "m4a");

});


test("the browser recorders still map correctly", () => {

  // iOS Safari records mp4; Chrome/Android record webm. Both go through the
  // pitch recorder and must keep working.
  assert.equal(extensionFor("audio/mp4"), "mp4");
  assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionFor("audio/wav"), "wav");
  assert.equal(extensionFor("audio/mpeg"), "mp3");

});


test("an unknown or missing type falls back to webm rather than throwing", () => {

  assert.equal(extensionFor(null), "webm");
  assert.equal(extensionFor(""), "webm");
  assert.equal(extensionFor("application/octet-stream"), "webm");

});
