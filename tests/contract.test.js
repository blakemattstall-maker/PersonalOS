// Contract tests — the wiring that, when it breaks, breaks silently.
//
// Nothing here touches the network or the database. These run in milliseconds
// and are meant to be run on every change, which is only possible because they
// have no external dependencies at all.
//
// The bug class this exists for: a tool gets added to lib/toolDefinitions.js so
// the model can call it, and the matching case in lib/router.js is forgotten.
// The model then confidently emits a tool call that throws "Unknown tool" at
// runtime — visible only as a 500 on the phone, from a code path no local run
// ever exercises.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { TOOLS } from "../lib/toolDefinitions.js";
import { MODELS } from "../lib/models.js";


const routerSource = fs.readFileSync(new URL("../lib/router.js", import.meta.url), "utf8");
const captureSource = fs.readFileSync(new URL("../api/capture.js", import.meta.url), "utf8");


function definedToolNames() {
  return TOOLS.map(t => t.function?.name ?? t.name).filter(Boolean);
}


function routedToolNames() {
  return [...routerSource.matchAll(/case\s+"([a-z_]+)"\s*:/g)].map(m => m[1]);
}


test("every tool the model can call has a router case", () => {

  const routed = new Set(routedToolNames());

  const orphans = definedToolNames().filter(name => !routed.has(name));

  assert.deepEqual(
    orphans,
    [],
    `These tools are exposed to the model but would throw "Unknown tool": ${orphans.join(", ")}`
  );

});


test("every router case is a tool the model actually knows about", () => {

  const defined = new Set(definedToolNames());

  const unreachable = routedToolNames().filter(name => !defined.has(name));

  assert.deepEqual(
    unreachable,
    [],
    `These router cases can never fire — no tool definition exposes them: ${unreachable.join(", ")}`
  );

});


test("tool definitions are structurally valid for the OpenAI tools parameter", () => {

  for (const tool of TOOLS) {

    assert.equal(tool.type, "function", `tool missing type:"function": ${JSON.stringify(tool).slice(0, 80)}`);
    assert.ok(tool.function?.name, "tool missing function.name");
    assert.ok(tool.function?.description, `${tool.function?.name}: missing description — the model picks tools by this`);
    assert.equal(typeof tool.function?.parameters, "object", `${tool.function?.name}: missing parameters schema`);

  }

});


test("tool names are unique", () => {

  const names = definedToolNames();

  assert.equal(new Set(names).size, names.length, "duplicate tool name in lib/toolDefinitions.js");

});


// The model registry exists so a provider deprecation is a one-file edit rather
// than a twenty-file sweep with nothing to catch a miss. That only holds if new
// call sites keep using it, so this test is the thing that enforces it.
test("no model string is hardcoded outside the registry", () => {

  const offenders = [];

  for (const dir of ["tools", "lib", "api"]) {
    walk(new URL(`../${dir}/`, import.meta.url), file => {

      if (file.pathname.endsWith("lib/models.js")) return;

      const source = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(/model:\s*"([^"]+)"/g)) {
        offenders.push(`${file.pathname.split("/PersonalOS/")[1]} -> "${match[1]}"`);
      }

    });
  }

  assert.deepEqual(
    offenders,
    [],
    `Hardcoded model strings — import MODELS from lib/models.js instead:\n  ${offenders.join("\n  ")}`
  );

});


test("every registry tier resolves to a real model id", () => {

  for (const [tier, id] of Object.entries(MODELS)) {
    assert.equal(typeof id, "string", `MODELS.${tier} is not a string`);
    assert.ok(id.length > 0, `MODELS.${tier} is empty`);
  }

  assert.ok(MODELS.ROUTER, "a router tier is required — api/capture.js depends on it");

});


// gpt-5.6-luna cannot use function tools in chat.completions except with
// reasoning_effort "none", and is ~2.5x slower. Routing is the one place that
// absolutely requires function tools, so this is worth asserting rather than
// only writing down.
test("the routing tier is not a model known to be unusable for routing", async () => {

  const { UNSUITABLE_FOR_ROUTING } = await import("../lib/models.js");

  assert.ok(
    !UNSUITABLE_FOR_ROUTING.includes(MODELS.ROUTER),
    `MODELS.ROUTER is set to ${MODELS.ROUTER}, which cannot reliably use function tools`
  );

});


// The routing eval parses the live system prompt out of api/capture.js so it can
// never drift from what production actually sends. That only works while the
// prompt stays in a template literal the eval can find.
test("the router system prompt is still extractable from api/capture.js", () => {

  assert.match(
    captureSource,
    /content:\s*`You are the planning engine/,
    "The router prompt moved or changed shape — tests/routing.eval.mjs extracts it by this marker and will silently test the wrong string."
  );

});


function walk(dir, visit) {

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {

    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);

    if (entry.isDirectory()) walk(child, visit);
    else if (entry.name.endsWith(".js")) visit(child);

  }

}
