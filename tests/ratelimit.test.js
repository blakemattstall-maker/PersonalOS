import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { rateLimit, clientIp, resetLimits } from "../web/lib/ratelimit.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const ttsSource = read("web/app/api/tts/route.js");


beforeEach(() => resetLimits());


// ---------------------------------------------------------------------------
// The limiter itself. Injectable clock, so time is an argument, not a wait.
// ---------------------------------------------------------------------------

test("the ceiling is exact: limit allowed, limit-plus-one refused", () => {

  const t0 = 1_000_000;

  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit("k", 5, { now: t0 + i }).ok, true, `call ${i + 1} of 5 must pass`);
  }

  const refused = rateLimit("k", 5, { now: t0 + 10 });

  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfter >= 1, "a refusal must say when to come back");

});


test("the window actually resets", () => {

  const t0 = 1_000_000;

  rateLimit("k", 1, { now: t0 });
  assert.equal(rateLimit("k", 1, { now: t0 + 59_000 }).ok, false, "still inside the window");
  assert.equal(rateLimit("k", 1, { now: t0 + 60_001 }).ok, true, "a new window is a new allowance");

});


test("keys are isolated — one hammered endpoint cannot starve another", () => {

  const t0 = 1_000_000;

  rateLimit("resource:finance:1.2.3.4", 1, { now: t0 });

  assert.equal(rateLimit("resource:finance:1.2.3.4", 1, { now: t0 + 1 }).ok, false);
  assert.equal(rateLimit("resource:brief:1.2.3.4", 1, { now: t0 + 1 }).ok, true, "different endpoint, own bucket");
  assert.equal(rateLimit("resource:finance:5.6.7.8", 1, { now: t0 + 1 }).ok, true, "different caller, own bucket");

});


test("the bucket map cannot grow forever", () => {

  // A long-lived instance being scanned by bots gains one entry per key. The
  // sweep runs once size crosses the threshold and clears expired windows —
  // without it this 'protection' is a slow memory leak with a nice name.
  const t0 = 1_000_000;

  for (let i = 0; i < 5001; i++) rateLimit(`scan:${i}`, 10, { now: t0 });

  // All 5001 have expired by now + 61s; the next call sweeps them.
  rateLimit("after", 10, { now: t0 + 61_000 });

  for (let i = 0; i < 100; i++) {
    assert.equal(
      rateLimit(`scan:${i}`, 10, { now: t0 + 61_001 }).ok,
      true,
      "expired buckets must have been reclaimable"
    );
  }

});


test("the caller's address is the first forwarded hop, never the whole chain", () => {

  assert.equal(clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }), "9.9.9.9");

  // The in-process path (backend.js) sends no forwarding header at all — the
  // dashboard's own server-side calls share one local bucket, which is fine
  // because the only real session is the owner's.
  assert.equal(clientIp({ headers: {} }), "local");
  assert.equal(clientIp({}), "local");

});


// ---------------------------------------------------------------------------
// Where the ceilings are actually bolted on. A limiter nothing calls is a
// library, not a defence.
// ---------------------------------------------------------------------------

test("every token-costing entry point carries a limit", () => {

  const resource = read("web/app/api/[resource]/handler.js");
  const capture = read("web/app/api/capture/handler.js");
  const ingest = read("web/app/api/ingest/[kind]/handler.js");

  assert.match(resource, /enforceLimit\(req, res, \{ name: `resource:\$\{req\.query\.resource\}`/);
  assert.match(capture, /enforceLimit\(req, res, \{ name: "capture", limit: 30 \}\)/);
  assert.match(ingest, /enforceLimit\(req, res, \{ name: "ingest", limit: 120 \}\)/);

  // And the guard sits AFTER auth in each: a 429 must never leak whether a
  // credential was valid.
  for (const [name, source] of [["resource", resource], ["capture", capture], ["ingest", ingest]]) {
    const auth = source.indexOf("requireAuth(req, res)");
    const limit = source.indexOf("enforceLimit(req, res");
    assert.ok(auth > 0 && limit > auth, `${name}: the limit must come after the auth check`);
  }

});


test("the cron routes are deliberately unthrottled", () => {

  // Throttling a scheduled job creates the silent skipped-run failure the
  // whole system is built to avoid. CRON_SECRET and Vercel's own invocation
  // are the guards there.
  assert.doesNotMatch(read("web/app/api/cron/[job]/handler.js"), /enforceLimit/);

});


// ---------------------------------------------------------------------------
// TTS — the route that was open to the world.
// ---------------------------------------------------------------------------

test("speech requires a session, and anonymity gets a 401", () => {

  // Until 2026-08-10 this route answered 200 to a request with no cookie and
  // no key: anyone on the internet could spend OpenAI tokens on the
  // project's bill. The session check is the fix; this pin is what stops a
  // refactor from quietly reopening it.
  assert.match(ttsSource, /const session = sessionOf\(request\)/);
  assert.match(ttsSource, /\{ status: 401 \}/);

  // The unset-env trap, same as the proxy: SITE_PASSPHRASE missing must not
  // make the owner check pass on undefined === undefined.
  assert.match(ttsSource, /process\.env\.SITE_PASSPHRASE && value === process\.env\.SITE_PASSPHRASE/);
  assert.match(ttsSource, /process\.env\.API_SECRET && request\.headers\.get\("x-pos-key"\) === process\.env\.API_SECRET/);

});


test("the demo may hear the feature but not fund a pipeline", () => {

  // The demo session is deliberately public, so for this one route auth IS
  // the rate limit's job: a visitor gets enough reads to hear the voice, a
  // script gets bored, and a pasted novel is refused outright.
  assert.match(ttsSource, /DEMO_TTS_PER_MINUTE = 8/);
  assert.match(ttsSource, /OWNER_TTS_PER_MINUTE = 30/);
  assert.match(ttsSource, /DEMO_TEXT_LIMIT = 2600/);
  assert.match(ttsSource, /\{ status: 413 \}/, "over-length demo text is refused, not truncated");
  assert.match(ttsSource, /\{ status: 429/, "and the ceiling answers 429");

});
