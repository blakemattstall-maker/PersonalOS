import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { INTERRUPTION_LEVELS, URGENCY_TIERS, DEFAULTS } from "../web/lib/settings.js";


// The interruption dial is the one setting that decides whether this app is
// tolerable to live with, and its failure mode is silence — which is also what
// working correctly looks like. That combination is why this file exists.
//
// The bug it was written for: `pushAllowed()` compared the urgency against the
// literal strings "digest" and "urgent", while real call sites passed "nudge"
// and "relationship_checkin". Those matched nothing, so two whole categories of
// notification were unreachable at two of the four dial settings, and nothing
// anywhere said so. The behaviour was accidentally correct; the next typo would
// not have been.


const ROOT = path.resolve(import.meta.dirname, "..");


function sourceFiles(dir, found = []) {

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {

    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      sourceFiles(full, found);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      found.push(full);
    }

  }

  return found;

}


// THE load-bearing test. Every urgency string the code actually passes has to
// be one the gate knows about, or that notification can never be delivered.
test("every urgency passed to pushAllowed() is a declared tier", () => {

  const offenders = [];

  for (const file of sourceFiles(ROOT)) {

    // The definition and this test itself both mention the name legitimately.
    if (file.endsWith(path.join("lib", "settings.js")) || file === import.meta.filename) continue;

    const source = fs.readFileSync(file, "utf8");

    for (const match of source.matchAll(/pushAllowed\(\s*(["'`])([^"'`]*)\1/g)) {

      const urgency = match[2];

      if (!(urgency in URGENCY_TIERS)) {
        offenders.push(`${path.relative(ROOT, file)} passes "${urgency}"`);
      }

    }

  }

  assert.deepEqual(
    offenders,
    [],
    `These pushes can never reach the phone at any dial setting below "everything", ` +
    `because their urgency is not in URGENCY_TIERS:\n  ${offenders.join("\n  ")}`
  );

});


test("every declared tier names a real interruption level", () => {

  for (const [urgency, level] of Object.entries(URGENCY_TIERS)) {
    assert.ok(
      INTERRUPTION_LEVELS.includes(level),
      `URGENCY_TIERS.${urgency} is "${level}", which is not an interruption level.`
    );
  }

});


// Replicates pushAllowed()'s decision without touching the database, so the
// whole truth table can be asserted offline.
function allows(level, urgency) {
  const rank = { silent: 0, digest: 1, digest_plus_urgent: 2, everything: 3 };
  return rank[level] >= rank[URGENCY_TIERS[urgency] ?? "everything"];
}


test("silent is actually silent", () => {

  for (const urgency of Object.keys(URGENCY_TIERS)) {
    assert.equal(allows("silent", urgency), false, `"${urgency}" escaped silent mode.`);
  }

});


test("everything really means everything", () => {

  for (const urgency of Object.keys(URGENCY_TIERS)) {
    assert.equal(allows("everything", urgency), true, `"${urgency}" was dropped at "everything".`);
  }

});


// Turning the dial up must never take a notification away. Without this, the
// levels are just four unrelated policies that happen to be listed in order.
test("the dial is monotonic — raising it never removes a notification", () => {

  for (const urgency of Object.keys(URGENCY_TIERS)) {

    let seenAllowed = false;

    for (const level of INTERRUPTION_LEVELS) {

      const allowed = allows(level, urgency);

      if (allowed) seenAllowed = true;

      assert.ok(
        !(seenAllowed && !allowed),
        `"${urgency}" is allowed at a lower level than "${level}" but blocked at "${level}".`
      );

    }

  }

});


// The agreed product decision, encoded so it can't drift by accident:
// one digest a day plus genuinely urgent things, and nothing else.
test("the default level is one digest a day plus urgent only", () => {

  assert.equal(DEFAULTS.interruption_level, "digest_plus_urgent");

  assert.equal(allows("digest_plus_urgent", "digest"), true);
  assert.equal(allows("digest_plus_urgent", "urgent"), true);
  assert.equal(allows("digest_plus_urgent", "nudge"), false);
  assert.equal(allows("digest_plus_urgent", "relationship_checkin"), false);

});
