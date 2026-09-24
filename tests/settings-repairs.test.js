import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";


const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


test("settings can repair the semantic index without exposing production secrets", () => {
  const handler = read("web/app/api/[resource]/handler.js");
  const actions = read("web/app/actions.js");
  const panel = read("web/app/SettingsPanel.js");

  assert.match(handler, /action === "repairMemoryEmbeddings"/);
  assert.match(handler, /backfillMemoryEmbeddings/);
  assert.match(actions, /repairMemoryEmbeddingsAction/);
  assert.match(panel, /Repair memory search/);
  assert.match(panel, /schema\.notReady/);
});


test("active reminders expose an owner-only disable control and retain their history", () => {
  const handler = read("web/app/api/[resource]/handler.js");
  const diagnostics = read("web/lib/diagnostics.js");
  const panel = read("web/app/SettingsPanel.js");

  assert.match(handler, /action === "disableTrigger"/);
  assert.match(handler, /\.update\(\{ active: false \}\)/);
  assert.doesNotMatch(handler, /from\("triggers"\)\s*\.delete/);
  assert.match(diagnostics, /id: t\.id/);
  assert.match(panel, /disableTriggerAction/);
});
