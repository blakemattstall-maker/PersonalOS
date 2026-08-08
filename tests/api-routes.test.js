import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";

import { nodeRoute } from "../web/app/api/_node.js";
import { FALLBACK_TIMEZONE } from "../web/lib/profile.js";


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

  // Several schedules deliberately point at the same job: Vercel Hobby crons
  // fire at most once a day each, so spreading nudges across the day is four
  // schedules for one deliverNudges job rather than one hourly schedule.
  const jobs = crons.map(c => c.path.replace("/api/cron/", ""));

  for (const required of ["morningBrief", "syncCanvas", "reviewIntentions", "syncNews", "deliverNudges"]) {
    assert.ok(jobs.includes(required), `the ${required} schedule went missing`);
  }

  assert.ok(
    jobs.filter(j => j === "deliverNudges").length >= 2,
    "nudge delivery needs more than one slot or it is not spread across the day"
  );

});


test("the morning chain still runs in the order the brief depends on", () => {

  // The brief is the end of a pipeline: Canvas assignments, the news digest and
  // the intention review all have to have landed before it is composed, or it
  // reports a day that is missing whatever came in late. Writing the brief and
  // announcing it were then split onto two schedules, which added a second
  // ordering constraint — there is nothing to announce before it is written.
  //
  // All five schedules are UTC minutes apart with no dependency declared
  // anywhere, so a later "let's move one job" is very easy to get wrong and
  // impossible to notice: the brief would simply be a bit less right, silently.
  const crons = JSON.parse(fs.readFileSync(path.join(ROOT, "web/vercel.json"), "utf8")).crons;

  const minutesOf = (job) => {
    const cron = crons.find(c => c.path === `/api/cron/${job}`);
    assert.ok(cron, `no schedule for ${job}`);
    const [minute, hour] = cron.schedule.split(" ");
    return Number(hour) * 60 + Number(minute);
  };

  const brief = minutesOf("morningBrief");

  for (const upstream of ["connectIslands", "syncNews", "syncCanvas", "reviewIntentions"]) {
    assert.ok(
      minutesOf(upstream) < brief,
      `${upstream} must run before morningBrief composes the day (it is at ${minutesOf(upstream)}, brief at ${brief})`
    );
  }

  assert.ok(
    minutesOf("briefPush") > brief,
    "briefPush would announce a brief that has not been written yet"
  );

});


test("the morning jobs land in the morning wherever the user actually is", () => {

  // Vercel cron schedules are UTC and have no idea about timezones, so moving
  // house silently reschedules the user's entire morning. That is not
  // hypothetical: the schedule was tuned for America/Los_Angeles, the user moved
  // to America/Chicago, and every one of these jumped two hours later — the brief
  // written at 6am instead of 4 and announced at 8 instead of 6, which is the
  // opposite of what the earlier-brief work was for.
  //
  // Asserting against FALLBACK_TIMEZONE ties the UTC numbers to the one place the
  // user's zone is written down in code, so changing that constant without
  // rescheduling fails here instead of in someone's morning.
  const crons = JSON.parse(fs.readFileSync(path.join(ROOT, "web/vercel.json"), "utf8")).crons;

  const localHours = (job) => {
    const cron = crons.find(c => c.path === `/api/cron/${job}`);
    const [minute, hour] = cron.schedule.split(" ");
    // Both sides of a DST boundary: a UTC schedule drifts an hour twice a year,
    // and the requirement is that it stays in a civilised window either way.
    return ["2026-07-01", "2026-12-01"].map(day =>
      DateTime.fromISO(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`, { zone: "utc" })
        .setZone(FALLBACK_TIMEZONE).hour
    );
  };

  for (const hour of localHours("morningBrief")) {
    assert.ok(hour >= 2 && hour <= 5,
      `the brief should be written in the small hours so it is ready however early the app is opened; got ${hour}:00 local`);
  }

  for (const hour of localHours("briefPush")) {
    assert.ok(hour >= 5 && hour <= 7,
      `the brief notification has to land at a civilised hour, not ${hour}:00 local`);
  }

  // Nudges are the one thing that should reach the user while they are awake.
  for (const cron of crons.filter(c => c.path.endsWith("deliverNudges"))) {
    const [minute, hour] = cron.schedule.split(" ");
    const local = DateTime.fromISO(`2026-07-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`, { zone: "utc" })
      .setZone(FALLBACK_TIMEZONE).hour;
    assert.ok(local >= 6 && local <= 21, `a nudge slot fires at ${local}:00 local, which is not waking hours`);
  }

});


test("the brief is written by one job and announced by another", () => {

  const handler = fs.readFileSync(path.join(API, "cron/[job]/handler.js"), "utf8");

  const write = handler.match(/async function morningBrief\(\)[\s\S]*?\n\}/)[0];

  // If morningBrief pushes again, the 4am write becomes a 4am notification and
  // the entire reason for the split is gone.
  assert.doesNotMatch(
    write,
    /sendPush|pushBrief/,
    "morningBrief must not notify — it runs at 4am local, which is nobody's idea of a good time to be buzzed"
  );

  const announce = handler.match(/async function briefPush\(\)[\s\S]*?\n\}\n\n\n/)[0];

  // Splitting one job in two means a failure in the first now costs both the
  // brief and its notification. briefPush composes as a fallback so 6am is still
  // a moment when a brief gets made if none exists.
  assert.match(announce, /composeBrief/, "briefPush must still be able to recover a missing brief");

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
