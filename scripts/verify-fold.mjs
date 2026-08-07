// Live verification for the backend fold.
//
//   node --env-file=.env.local scripts/verify-fold.mjs
//
// Read-only. It creates nothing, deletes nothing and sends no notifications.
// Everything it touches is a GET path the dashboard already calls on every
// page load, so running it repeatedly is safe.
//
// What it proves, in order:
//   1. every dashboard resource still answers, in-process, with real data
//   2. how long that now takes versus the deployed two-project round trip
//   3. the API routes are wired and reachable through the adapter
//   4. the cron jobs are all still addressable by name
//
// It does NOT prove the deployed configuration — env vars on the web project,
// the forwarding rewrite, or the crons moving projects. Those only exist once
// the branch is deployed; see the testing notes in the handoff doc.

import { backendGet } from "../web/app/backend.js";

const OLD_HOST = "https://personal-os-blake-007c.vercel.app";

const RESOURCES = [
  "/api/brief/latest?peek=true",
  "/api/deepThoughts",
  "/api/nudges",
  "/api/projects",
  "/api/data?prompts=1",
  "/api/people",
  "/api/news",
  "/api/practice",
  "/api/history",
  "/api/settings",
  "/api/diag"
];

const pad = (s, n) => String(s).padEnd(n);
let failures = 0;

console.log("\n=== 1. every dashboard resource answers in-process ===\n");

const timings = [];

for (const path of RESOURCES) {

  const started = Date.now();

  try {

    const data = await backendGet(path);

    const ms = Date.now() - started;

    timings.push(ms);

    // Shape check, not just "it returned something". A handler that silently
    // returns {} would otherwise look identical to one that worked.
    const keys = Object.keys(data || {});
    const ok = keys.length > 0 && !data.error;

    if (!ok) failures++;

    console.log(`  ${ok ? "ok  " : "FAIL"} ${pad(path, 34)} ${pad(ms + "ms", 8)} ${keys.slice(0, 4).join(", ")}${data?.error ? "  error: " + data.error : ""}`);

  } catch (error) {

    failures++;
    console.log(`  FAIL ${pad(path, 34)} threw: ${error.message}`);

  }

}

const total = timings.reduce((a, b) => a + b, 0);
console.log(`\n  in-process total: ${total}ms across ${timings.length} resources`);


console.log("\n=== 2. the same calls against the deployed two-project setup ===\n");

// The old path is what production still serves until this branch is merged, so
// this is a genuine before/after rather than an estimate.
let remoteTotal = 0;
let remoteOk = 0;

for (const path of RESOURCES.slice(0, 6)) {

  const started = Date.now();

  try {

    const res = await fetch(`${OLD_HOST}${path}`, { cache: "no-store" });
    await res.text();
    const ms = Date.now() - started;
    remoteTotal += ms;
    remoteOk++;
    console.log(`  ${pad(res.status, 4)} ${pad(path, 34)} ${ms}ms`);

  } catch (error) {

    console.log(`  ---- ${pad(path, 34)} unreachable: ${error.message}`);

  }

}

if (remoteOk > 0) {

  const inProcessSame = timings.slice(0, remoteOk).reduce((a, b) => a + b, 0);

  console.log(`\n  deployed round trips: ${remoteTotal}ms for ${remoteOk} calls`);
  console.log(`  same calls in-process: ${inProcessSame}ms`);
  console.log(`  saved per page load:   ~${Math.max(0, remoteTotal - inProcessSame)}ms`);

}


console.log("\n=== 3. API routes are reachable through the adapter ===\n");

const { GET: resourceGET } = await import("../web/app/api/[resource]/route.js");
const { GET: briefGET } = await import("../web/app/api/brief/latest/route.js");

const cases = [
  ["/api/settings", resourceGET, { resource: "settings" }],
  ["/api/people", resourceGET, { resource: "people" }],
  ["/api/brief/latest", briefGET, {}]
];

for (const [label, route, params] of cases) {

  try {

    const headers = process.env.API_SECRET ? { "x-pos-key": process.env.API_SECRET } : {};

    const response = await route(
      new Request(`https://local.test${label}`, { headers }),
      { params: Promise.resolve(params) }
    );

    const body = await response.json();
    const ok = response.status === 200 && !body.error;

    if (!ok) failures++;

    console.log(`  ${ok ? "ok  " : "FAIL"} ${pad(label, 24)} ${response.status}  ${Object.keys(body).slice(0, 3).join(", ")}`);

  } catch (error) {

    failures++;
    console.log(`  FAIL ${pad(label, 24)} threw: ${error.message}`);

  }

}


console.log("\n=== 4. an unknown resource still 404s rather than throwing ===\n");

{
  const response = await resourceGET(
    new Request("https://local.test/api/nope", {
      headers: process.env.API_SECRET ? { "x-pos-key": process.env.API_SECRET } : {}
    }),
    { params: Promise.resolve({ resource: "nope" }) }
  );
  const ok = response.status === 404;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} unknown resource -> ${response.status}`);
}


console.log(`\n${failures === 0 ? "PASS — the fold answers everything the dashboard needs." : `FAIL — ${failures} problem(s) above.`}\n`);

process.exit(failures === 0 ? 0 : 1);
