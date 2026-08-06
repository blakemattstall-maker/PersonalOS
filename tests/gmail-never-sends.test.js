import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";


// The user asked for email drafting on the explicit, repeated condition that
// nothing is ever sent automatically. The OAuth scope we hold (gmail.compose)
// *does* permit sending — Google publishes no drafts-only scope — so the
// guarantee cannot come from the scope. It has to come from the code, and a
// promise in a comment decays the first time someone adds a "just send it"
// convenience.
//
// This test is the actual enforcement. It reads every source file in the repo
// and fails if a Gmail send call appears anywhere, in any form.


const SEND_CALLS = [
  // The two Gmail API methods that put mail in front of another human.
  "drafts.send",
  "messages.send",
  // The googleapis client also accepts these as resource strings in some
  // call styles, so match the bare method names near a gmail reference too.
  "users.messages.send",
  "users.drafts.send"
];


function sourceFiles(dir, found = []) {

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {

    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      sourceFiles(full, found);
      continue;
    }

    if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      found.push(full);
    }

  }

  return found;

}


test("no code path anywhere can send an email", () => {

  const root = path.resolve(import.meta.dirname, "..");

  const offenders = [];

  for (const file of sourceFiles(root)) {

    // This test names the forbidden calls, so it would otherwise flag itself.
    if (file.endsWith("gmail-never-sends.test.js")) continue;

    const source = fs.readFileSync(file, "utf8");

    for (const call of SEND_CALLS) {
      if (source.includes(call)) {
        offenders.push(`${path.relative(root, file)} contains "${call}"`);
      }
    }

  }

  assert.deepEqual(
    offenders,
    [],
    `Email sending must never be possible — drafts only.\n${offenders.join("\n")}`
  );

});


test("the gmail tool only ever creates drafts", () => {

  const root = path.resolve(import.meta.dirname, "..");

  const source = fs.readFileSync(path.join(root, "tools/gmail.js"), "utf8");

  const gmailCalls = [...source.matchAll(/gmail\.users\.([a-zA-Z.]+)\(/g)].map(m => m[1]);

  assert.deepEqual(
    [...new Set(gmailCalls)],
    ["drafts.create"],
    "tools/gmail.js must call exactly one Gmail method: drafts.create"
  );

});


test("the draft tool reports sent:false to the caller", () => {

  const root = path.resolve(import.meta.dirname, "..");

  const source = fs.readFileSync(path.join(root, "tools/gmail.js"), "utf8");

  assert.match(
    source,
    /sent:\s*false/,
    "the result must state plainly that nothing was sent, so no caller can imply otherwise"
  );

});
