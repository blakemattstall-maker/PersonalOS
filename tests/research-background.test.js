import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const RESEARCH = readFileSync(new URL("../web/tools/research.js", import.meta.url), "utf8");
const HANDLER = readFileSync(new URL("../web/app/api/capture/handler.js", import.meta.url), "utf8");
const NOTIFY = readFileSync(new URL("../web/lib/captureNotify.js", import.meta.url), "utf8");


test("phone research acknowledges before hosted search finishes", () => {
  assert.match(RESEARCH, /if \(defer\) \{[\s\S]*waitUntil\(/);
  assert.match(HANDLER, /toolName === "research_query"[\s\S]*defer: true/);
});


test("background research delivers the real answer once", () => {
  assert.match(RESEARCH, /finishResearch\(query, \{ notify: true \}\)/);
  assert.match(RESEARCH, /notifyCapture\(\[\{ tool: "research_query", result: completed \}\], query\)/);
  assert.match(NOTIFY, /quiet_ack/);
});


test("research inside a dependent chain stays synchronous", () => {
  assert.match(RESEARCH, /return finishResearch\(query\);/);
});
