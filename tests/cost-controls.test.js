import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, BACKGROUND_AI_CADENCES } from "../web/lib/settings.js";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");


test("economy mode is the safe default and remains user-selectable", () => {
  assert.equal(DEFAULTS.background_ai_cadence, "economy");
  assert.deepEqual(BACKGROUND_AI_CADENCES, ["economy", "daily"]);

  const panel = read("web/app/SettingsPanel.js");
  assert.match(panel, /Background AI cost/);
  assert.match(panel, /Manual requests are always immediate/);
});


test("economy mode gates expensive autonomous work without gating housekeeping", () => {
  const cron = read("web/app/api/cron/[job]/handler.js");

  assert.match(cron, /backgroundPolicy\(\[1, 4\]\)/);
  assert.match(cron, /backgroundPolicy\(\[7\]\)/);
  assert.match(cron, /policy\.due \? reviewIntentionsForNudges\(\)/);

  // These deterministic syncs still run every morning.
  assert.match(cron, /const completionResult = await syncTaskCompletions\(\)/);
  assert.match(cron, /metricsResult = await rollupDailyMetrics\(\)/);
});


test("the daily brief uses the lower-cost tier and economy news keeps three stories", () => {
  const brief = read("web/tools/brief.js");
  const cron = read("web/app/api/cron/[job]/handler.js");
  const news = read("web/tools/news.js");

  assert.match(brief, /model: MODELS\.EXTRACT/);
  assert.match(cron, /policy\.cadence === "daily" \? 7 : 3/);
  assert.match(news, /Math\.max\(1, Math\.min\(limit, KEEP_PER_RUN\)\)/);
});


test("calendar triggers use the fifteen-minute cadence their firing window supports", () => {
  assert.match(read("docs/cron-triggers.sql"), /'\*\/15 \* \* \* \*'/);
  assert.match(read("web/tools/triggers.js"), /const EVENT_WINDOW_MINUTES = 20/);
});
