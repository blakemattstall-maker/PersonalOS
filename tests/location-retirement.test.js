import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { LOCATION_ENABLED } from "../web/lib/featureFlags.js";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("retired location tracking cannot ingest or run background analysis", () => {
  assert.equal(LOCATION_ENABLED, false);

  const ingest = read("web/app/api/ingest/[kind]/handler.js");
  assert.match(ingest, /!LOCATION_ENABLED && kind === "location"/);
  assert.doesNotMatch(ingest, /^import .*tools\/location/m);

  const cron = read("web/app/api/cron/[job]/handler.js");
  assert.doesNotMatch(cron, /linkVisitsToEvents/);

  const signals = read("web/lib/signals.js");
  assert.match(signals, /if \(!LOCATION_ENABLED\) return null/);

  const settings = read("web/app/SettingsPanel.js");
  assert.doesNotMatch(settings, /diag\.location/);
});

test("relationship backlogs release only one reminder per pass", () => {
  const people = read("web/tools/people.js");
  const check = people.slice(people.indexOf("export async function checkRelationshipCheckins"));

  assert.match(check, /due\.find\(p => !pendingIds\.has\(p\.id\)\)/);
  assert.match(check, /prompted: 1/);
  assert.doesNotMatch(check, /for \(const person of due\)/);
  assert.doesNotMatch(check, /sendPush\(/);
});

test("paused internships cannot leak into the morning brief", () => {
  const brief = read("web/tools/brief.js");
  assert.match(brief, /JOBS_ENABLED\s*\? settle\("jobs"/);
});
