import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";


// A secret in a tracked file, caught before it is pushed.
//
// This exists because it happened. docs/cron-triggers.sql ships as a TEMPLATE —
// it carries the literal string PUT_YOUR_CRON_SECRET_HERE and the owner fills it
// in before pasting the statement into Supabase. He filled it in, in the file,
// which is the obvious thing to do. The next commit ran `git add -A`, swept up
// that edit, and pushed the live CRON_SECRET to a public repository. GitGuardian
// found it within minutes; so would anything else watching.
//
// Rewriting the commit does not undo it — GitHub still serves an orphaned
// commit by its SHA, so the value had to be rotated. That is the real cost, and
// this test is cheaper than paying it twice.
//
// It checks the tracked tree, not the diff: a value that arrives by any route —
// an editor, a paste, `git add -A` — is caught the same way.


const ROOT = path.resolve(import.meta.dirname, "..");

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);


// Values that are meant to be there. A template's placeholder is not a leak,
// and neither is an obvious example.
const PLACEHOLDERS = [
  /^PUT_YOUR_[A-Z_]+_HERE$/,
  /^YOUR_[A-Z_]+$/,
  /^<[^>]+>$/,
  /^\$\{[^}]+\}$/,
  /^(xxx+|placeholder|example|changeme|redacted|token|secret)$/i
];

const isPlaceholder = (value) => PLACEHOLDERS.some(p => p.test(value));


test("no tracked file carries a filled-in bearer token", () => {

  const offenders = [];

  for (const file of tracked) {

    let source;

    try {
      source = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }

    for (const match of source.matchAll(/Bearer\s+([^\s"'`}]+)/g)) {

      const value = match[1];

      // Interpolation and template syntax are how the real code passes one.
      if (isPlaceholder(value)) continue;
      if (value.includes("${") || value.startsWith("$")) continue;

      // An escaped regex source — tests/traps.test.js asserts on the shape of
      // this very header, so it necessarily contains the words.
      if (value.includes("\\")) continue;

      // "Bearer undefined" is the OLD BUG, quoted in the premortem, in
      // traps.test.js and in the OAuth handler's comment: the check compared
      // against a template string that interpolated an unset variable, so
      // anyone sending exactly "Bearer undefined" authenticated. It is
      // documentation of a fixed hole, not a hole.
      if (value === "undefined" || value === "null") continue;

      // Nothing this project uses as a secret is shorter than this, and a
      // scanner that flags fragments is a scanner that gets muted.
      if (value.length < 20) continue;

      offenders.push(`${file} — Bearer ${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`);

    }

  }

  assert.deepEqual(
    offenders,
    [],
    "\n\nA live credential is sitting in a tracked file:\n\n  " +
    offenders.join("\n  ") +
    "\n\nRewriting the commit does not undo a push — GitHub serves orphaned commits\n" +
    "by SHA. Put the placeholder back AND rotate the value.\n"
  );

});


test("no tracked file carries a long high-entropy hex string", () => {

  // The shape most of this project's secrets take: 32+ hex characters with no
  // vowel-and-consonant structure. Deliberately narrow — a wide entropy check
  // over a repo full of hashes and ids would cry wolf until it was ignored.
  const offenders = [];

  const allowed = new Set([
    "package-lock.json",
    "web/package-lock.json"
  ]);

  for (const file of tracked) {

    if (allowed.has(file)) continue;

    // Lockfile integrity hashes, git SHAs in prose, and test fixtures of
    // ids are the honest false positives; scope to the file types that hold
    // configuration a person pastes into.
    if (!/\.(sql|md|ya?ml|json|env|sh)$/.test(file)) continue;

    let source;

    try {
      source = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }

    for (const match of source.matchAll(/\b[0-9a-f]{40,}\b/g)) {
      offenders.push(`${file} — ${match[0].slice(0, 6)}…${match[0].slice(-4)} (${match[0].length} hex chars)`);
    }

  }

  assert.deepEqual(offenders, [], `\n\nHigh-entropy value in a tracked config file:\n  ${offenders.join("\n  ")}\n`);

});


test("the cron templates still say where the secret goes", () => {

  // If a template stops naming its placeholder, the test above stops having
  // anything to compare against and the next paste goes through unnoticed.
  const templates = tracked.filter(f => /^docs\/cron-.*\.sql$/.test(f));

  assert.ok(templates.length > 0, "no cron templates found — this test is not reading what it thinks");

  for (const file of templates) {

    const source = fs.readFileSync(path.join(ROOT, file), "utf8");

    assert.match(
      source,
      /PUT_YOUR_CRON_SECRET_HERE/,
      `${file} no longer carries its placeholder — either it was filled in, or the convention changed`
    );

  }

});
