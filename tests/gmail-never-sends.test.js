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
  "users.drafts.send",
  // Reading the inbox arrived alongside a scope broad enough to make these
  // reachable one widening away. Losing his mail is a different disaster from
  // sending it, and neither is one this app should ever be able to cause.
  "messages.trash",
  "messages.batchDelete",
  "users.messages.trash"
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


// Reading the inbox was added deliberately, so this widened from "exactly one
// method" to a closed allowlist. Closed is the load-bearing word: a method that
// is not named here fails the suite, so gaining a new Gmail capability stays a
// conscious edit to this file rather than something that arrives quietly with a
// feature. Everything on the list is read-only apart from drafts.create.
//
// Note what is deliberately absent: messages.modify, messages.trash and
// messages.delete. The readonly scope cannot perform them today, but scopes get
// widened and this list should refuse them regardless of what Google permits.
const ALLOWED_GMAIL_CALLS = [
  "drafts.create",
  "messages.list",
  "messages.get"
];


test("the gmail tool uses only allowlisted Gmail methods", () => {

  const root = path.resolve(import.meta.dirname, "..");

  const source = fs.readFileSync(path.join(root, "web/tools/gmail.js"), "utf8");

  const gmailCalls = [...new Set(
    [...source.matchAll(/gmail\.users\.([a-zA-Z.]+)\(/g)].map(m => m[1])
  )];

  const unexpected = gmailCalls.filter(c => !ALLOWED_GMAIL_CALLS.includes(c));

  assert.deepEqual(
    unexpected,
    [],
    `web/tools/gmail.js calls a Gmail method that is not allowlisted: ${unexpected.join(", ")}. ` +
    `If it is genuinely wanted, add it to ALLOWED_GMAIL_CALLS and say why.`
  );

  assert.ok(
    gmailCalls.includes("drafts.create"),
    "drafts.create disappeared — the drafting path is what this file exists for."
  );

});


test("the draft tool reports sent:false to the caller", () => {

  const root = path.resolve(import.meta.dirname, "..");

  const source = fs.readFileSync(path.join(root, "web/tools/gmail.js"), "utf8");

  assert.match(
    source,
    /sent:\s*false/,
    "the result must state plainly that nothing was sent, so no caller can imply otherwise"
  );

});
