import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DEFAULTS } from "../web/lib/settings.js";


const read = (file) => fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");


test("job delivery is off by default while collection remains available", () => {
  assert.equal(DEFAULTS.jobs_push_enabled, false);
  assert.equal(DEFAULTS.jobs_feed_enabled, false);

  const jobs = read("web/tools/jobs.js");
  assert.match(jobs, /pollJobBoards\(\)/, "the crawler still runs");
  assert.match(jobs, /if \(pushEnabled\)[\s\S]*?sendPush\(/, "phone delivery is independently gated");
  assert.match(jobs, /if \(feedEnabled\)[\s\S]*?from\("prompts"\)/, "Today messages are independently gated");
});


test("muted job delivery cannot create a re-enable backlog", () => {
  const jobs = read("web/tools/jobs.js");
  const claim = jobs.indexOf('update({ notified_at: new Date().toISOString() })');
  const pushGuard = jobs.indexOf("if (pushEnabled)", claim);
  const feedGuard = jobs.indexOf("if (feedEnabled)", claim);

  assert.ok(claim > 0 && claim < pushGuard && claim < feedGuard);
});


test("the Today counter uses exact totals and bulk clear reaches every queue", () => {
  const page = read("web/app/page.js");
  const database = read("web/tools/database.js");

  assert.match(page, /waitingCount = pendingThoughts\.count \+ pendingNudges\.count \+ raised\.promptCount \+ raised\.insightCount/);
  assert.match(page, /<ClearQueueButton count=\{waiting\}/);

  for (const table of ["deep_thoughts", "nudges", "prompts", "insights"]) {
    assert.match(database, new RegExp(`from\\("${table}"\\)`));
  }
});
