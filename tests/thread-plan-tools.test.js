import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";


// Regression test for a real bug: runPlanBuild() computed `tools` from the
// caller's toggles, then called executePlanBuild({ deep_thought_id }) —
// dropping it. executePlanBuild had no `tools` parameter and no local
// definition, but its body referenced `tools.tasks`, `tools.events`,
// `tools.research`, `tools.docs` and `tools.gmail` throughout.
//
// Because the whole build runs inside a fire-and-forget background promise
// (waitUntil), the ReferenceError never reached the user. buildPlan() had
// already returned "Building your plan now" and the client had nothing left
// to await. The background job died silently, the thread reset itself to
// ready_to_build, and from the dashboard it looked exactly like the user
// described it: loaded for a few seconds, stopped, no confirmation, no plan.
//
// This class of bug — a parameter silently dropped between two functions,
// caught by a generic try/catch, with no test ever calling the function for
// real — is exactly what slips through when nothing here runs against live
// services. Full execution is covered by hand against real data (see the
// commit that fixed this); this is the cheap, offline, permanent guard: prove
// the dependency is wired, without needing OpenAI/Supabase/Google credentials.

test("executePlanBuild receives `tools` from its caller and declares it as a parameter", () => {

  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "web", "tools", "thread.js"),
    "utf8"
  );

  // The call site inside runPlanBuild.
  const callMatch = source.match(/executePlanBuild\(\{([^}]*)\}\)/);
  assert.ok(callMatch, "expected a call to executePlanBuild({ ... }) in web/tools/thread.js");

  assert.match(
    callMatch[1],
    /\btools\b/,
    "executePlanBuild is called without passing `tools` — this is the exact bug that shipped: " +
    "the build silently ReferenceErrors inside the background job and the thread resets to " +
    "ready_to_build with no visible failure."
  );

  // The function's own parameter list.
  const defMatch = source.match(/async function executePlanBuild\(\{([^}]*)\}\)/);
  assert.ok(defMatch, "expected `async function executePlanBuild({ ... })` in web/tools/thread.js");

  assert.match(
    defMatch[1],
    /\btools\b/,
    "executePlanBuild's body references tools.tasks/events/research/docs/gmail but " +
    "`tools` is not in its parameter list — it would be undefined the moment any of " +
    "those are read."
  );

});


test("every tools.<key> referenced inside executePlanBuild is a real PLAN_TOOLS key", async () => {

  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "web", "tools", "thread.js"),
    "utf8"
  );

  // Isolate the function body so a match elsewhere in the file (there is
  // none today, but this keeps the test meaningful if one is ever added)
  // doesn't produce a false pass.
  const start = source.indexOf("async function executePlanBuild(");
  assert.notEqual(start, -1);

  const end = source.indexOf("\nexport async function buildPlan(", start);
  const body = end === -1 ? source.slice(start) : source.slice(start, end);

  const referenced = [...body.matchAll(/\btools\.([a-zA-Z_]+)/g)].map(m => m[1]);

  assert.ok(referenced.length > 0, "expected executePlanBuild to actually gate something on tools.*");

  const { PLAN_TOOLS } = await import("../web/lib/planTools.js");

  for (const key of new Set(referenced)) {
    assert.ok(
      key in PLAN_TOOLS,
      `executePlanBuild reads tools.${key}, which is not a key in PLAN_TOOLS (${Object.keys(PLAN_TOOLS).join(", ")})`
    );
  }

});
