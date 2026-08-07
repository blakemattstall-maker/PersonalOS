import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { nodeRoute } from "../web/app/api/_node.js";


// The backend used to be its own Vercel project of plain Node functions. It now
// runs inside the Next.js app, which means every request that used to arrive as
// (req, res) arrives as a Request and has to leave as a Response.
//
// Rather than rewrite ~1,450 lines of handler by hand, the handlers were kept
// byte-identical and adapted (web/app/api/_node.js). That trade moves all the
// risk into one small file and the wiring around it — which is exactly what
// this file tests. Everything here is offline: the Supabase client is built
// lazily, so importing a route never needs credentials.


const ROOT = path.resolve(import.meta.dirname, "..");
const API = path.join(ROOT, "web/app/api");


// Read out of the source rather than imported: proxy.js imports next/server,
// which plain Node cannot resolve through Next's export map, and this suite is
// deliberately runnable without a bundler.
function proxyMatcher() {

  const source = fs.readFileSync(path.join(ROOT, "web/proxy.js"), "utf8");

  const match = source.match(/matcher:\s*\[\s*"([^"]+)"/);

  assert.ok(match, "could not find the matcher in web/proxy.js");

  // Anchored, because that is what Next.js does. A matcher string is compiled
  // as a full-path pattern, not a search. Testing it unanchored is misleading
  // in the worst direction: "/api/capture" appears to match by starting at the
  // second slash, so the gate looks broken when it is not.
  return new RegExp(`^${match[1]}$`);

}


// --- the adapter ---------------------------------------------------------

test("a JSON response keeps its status, body and headers", async () => {

  const route = nodeRoute((req, res) => {
    res.setHeader("x-test", "1");
    res.status(201).json({ ok: true, method: req.method });
  });

  const response = await route(new Request("https://x.test/api/thing", { method: "POST" }));

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-test"), "1");
  assert.deepEqual(await response.json(), { ok: true, method: "POST" });

});


test("route params and query string arrive together on req.query", async () => {

  let seen;

  const route = nodeRoute((req, res) => { seen = req.query; res.json({}); });

  await route(
    new Request("https://x.test/api/data?prompts=1&peek=true"),
    { params: Promise.resolve({ resource: "data" }) }
  );

  assert.equal(seen.resource, "data", "the [resource] path segment must be readable as req.query.resource");
  assert.equal(seen.prompts, "1");
  assert.equal(seen.peek, "true");

});


test("a JSON body is parsed onto req.body", async () => {

  let seen;

  const route = nodeRoute((req, res) => { seen = req.body; res.json({}); });

  await route(new Request("https://x.test/api/data", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "note", id: "abc" })
  }));

  assert.deepEqual(seen, { type: "note", id: "abc" });

});


// Overland does not reliably announce its content type, and a dropped body
// there means silently losing GPS history.
test("a body without a content-type is still parsed", async () => {

  let seen;

  const route = nodeRoute((req, res) => { seen = req.body; res.json({}); });

  await route(new Request("https://x.test/api/ingest/location", {
    method: "POST",
    body: JSON.stringify({ locations: [1, 2] })
  }));

  assert.deepEqual(seen, { locations: [1, 2] });

});


test("headers are readable in lowercase, which is how the auth check reads them", async () => {

  let seen;

  const route = nodeRoute((req, res) => { seen = req.headers; res.json({}); });

  await route(new Request("https://x.test/api/data", { headers: { "X-Pos-Key": "secret" } }));

  assert.equal(seen["x-pos-key"], "secret");

});


test("a thrown handler becomes a 500 rather than an unhandled rejection", async () => {

  const route = nodeRoute(async () => { throw new Error("boom"); });

  const response = await route(new Request("https://x.test/api/thing"));

  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /boom/);

});


test("responding twice does not reject an already-settled response", async () => {

  const route = nodeRoute((req, res) => {
    res.status(200).json({ first: true });
    res.status(500).json({ second: true });
  });

  const response = await route(new Request("https://x.test/api/thing"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { first: true });

});


// The OAuth login step answers with a redirect to Google, not with JSON.
test("redirect produces a real redirect response", async () => {

  const route = nodeRoute((req, res) => res.redirect("https://accounts.google.com/o/oauth2/v2/auth"));

  const response = await route(new Request("https://x.test/api/auth/google/login"));

  assert.ok([301, 302, 303, 307, 308].includes(response.status), `got ${response.status}`);
  assert.match(response.headers.get("location"), /accounts\.google\.com/);

});


// --- the wiring ----------------------------------------------------------

const EXPECTED_ROUTES = [
  ["capture/route.js", ["POST"]],
  ["[resource]/route.js", ["GET", "POST"]],
  ["cron/[job]/route.js", ["GET"]],
  ["ingest/[kind]/route.js", ["POST"]],
  ["auth/google/[step]/route.js", ["GET"]],
  ["brief/latest/route.js", ["GET"]]
];


test("every public URL still exists as a route, with the methods its caller uses", async () => {

  for (const [file, methods] of EXPECTED_ROUTES) {

    const full = path.join(API, file);

    assert.ok(fs.existsSync(full), `${file} is missing — a public URL would 404`);

    const mod = await import(full);

    for (const method of methods) {
      assert.equal(typeof mod[method], "function", `${file} does not export ${method}`);
    }

  }

});


// The iOS Shortcut is hand-edited on a phone and is not in version control, so
// these paths cannot change. This is the list of URLs that must keep resolving.
test("the URLs the Shortcut, Overland, cron and Google use are all present", () => {

  const required = [
    "capture/route.js",
    "brief/latest/route.js",
    "ingest/[kind]/route.js",
    "cron/[job]/route.js",
    "auth/google/[step]/route.js"
  ];

  for (const file of required) {
    assert.ok(fs.existsSync(path.join(API, file)), `${file} is missing`);
  }

});


test("every route file sits next to a handler it can import", () => {

  const orphans = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== "route.js") continue;
      const source = fs.readFileSync(full, "utf8");
      for (const m of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const target = path.resolve(path.dirname(full), m[1]);
        if (!fs.existsSync(target)) orphans.push(`${path.relative(ROOT, full)} -> ${m[1]}`);
      }
    }
  };

  walk(API);

  assert.deepEqual(orphans, [], `route files importing something that does not exist:\n${orphans.join("\n")}`);

});


// --- the trap this migration could most easily have shipped ---------------

// The passphrase gate redirects anything unmatched to /login. Now that the API
// lives inside the same app, its callers are not browsers and hold no session
// cookie: the Shortcut, Overland, Vercel Cron and Google's OAuth redirect. If
// the matcher covered /api they would all receive an HTML login page instead —
// a capture would appear to succeed and silently do nothing.
test("the passphrase gate does not cover /api", () => {

  const pattern = proxyMatcher();

  const mustBypass = [
    "/api/capture",
    "/api/brief/latest",
    "/api/ingest/location",
    "/api/cron/morningBrief",
    "/api/auth/google/callback",
    "/api/data"
  ];

  for (const url of mustBypass) {
    assert.equal(pattern.test(url), false, `${url} would be redirected to the login page`);
  }

});


test("the passphrase gate still covers every real page", () => {

  const pattern = proxyMatcher();

  for (const url of ["/", "/data", "/people", "/settings", "/news", "/practice", "/history"]) {
    assert.equal(pattern.test(url), true, `${url} is no longer behind the passphrase`);
  }

  // …and still lets the installable-app files through, or push registration
  // fails with no useful error.
  for (const url of ["/login", "/sw.js", "/manifest.json", "/icon.svg"]) {
    assert.equal(pattern.test(url), false, `${url} must stay reachable without the cookie`);
  }

});


// --- crons ---------------------------------------------------------------

test("every scheduled job points at a job the cron handler actually knows", () => {

  const crons = JSON.parse(fs.readFileSync(path.join(ROOT, "web/vercel.json"), "utf8")).crons;

  const handler = fs.readFileSync(path.join(API, "cron/[job]/handler.js"), "utf8");

  const known = handler.match(/const JOBS = \{([^}]+)\}/)[1]
    .split(",").map(s => s.trim()).filter(Boolean);

  for (const cron of crons) {
    const job = cron.path.replace("/api/cron/", "");
    assert.ok(known.includes(job), `scheduled "${job}" but the handler has no such job (has: ${known.join(", ")})`);
  }

  assert.equal(crons.length, 4, "a cron went missing in the move");

});


test("the old project forwards every API path and nothing else", () => {

  const rewrites = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")).rewrites;

  assert.equal(rewrites.length, 1);
  assert.equal(rewrites[0].source, "/api/:path*");
  assert.match(rewrites[0].destination, /^https:\/\/.+\/api\/:path\*$/);

  // Crons must not remain on a project that no longer has the functions.
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.ok(!root.crons, "the forwarding project still declares crons — they would 404");

});
