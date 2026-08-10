import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEMO_SESSION } from "../web/lib/demo.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const demoSource = read("web/lib/demo.js");
const proxySource = read("web/proxy.js");
const backendSource = read("web/app/backend.js");
const loginSource = read("web/app/login/page.js");


// ---------------------------------------------------------------------------
// The demo is an invitation to a FICTIONAL dashboard. Every test here guards
// one boundary: a stranger holding the public passphrase must never read a
// real row or write anything at all.
// ---------------------------------------------------------------------------

test("the demo module is a bare constant the edge runtime can import", () => {

  // proxy.js runs on the edge, where next/headers does not exist. The moment
  // someone adds a cookies() helper to this module for convenience, the
  // middleware build breaks — or worse, silently stops matching.
  assert.doesNotMatch(demoSource, /next\/headers|cookies\(/);
  assert.equal(DEMO_SESSION, "demo");

});


test("the proxy admits the demo session to pages", () => {

  assert.match(proxySource, /cookie\?\.value === DEMO_SESSION/);

  // And the real-passphrase check still guards against the unset-env trap:
  // SITE_PASSPHRASE missing must not make the REAL session comparison pass.
  assert.match(proxySource, /passphrase && cookie\?\.value === passphrase/);

});


test("a demo read is answered from fixtures and can never fall through to Supabase", () => {

  const get = backendSource.slice(
    backendSource.indexOf("export async function backendGet"),
    backendSource.indexOf("export async function backendPost")
  );

  // Order is the security property: fixture lookup, then the demo dead-end,
  // and only THEN invoke(). A demo request that reaches invoke() is handed
  // the service-role credential and the real bank feed with it — the
  // uncovered-path fall-through is the entire attack surface here.
  const fixture = get.indexOf("fixtureFor(path)");
  const deadEnd = get.indexOf('if (demo) return { success: false, demo: true');
  const realCall = get.indexOf('invoke({ method: "GET", path })');

  assert.ok(fixture > 0, "the fixture lookup must exist");
  assert.ok(deadEnd > fixture, "the demo dead-end must follow the fixture miss");
  assert.ok(realCall > deadEnd, "and the real call must be unreachable for a demo session");

});


test("a demo write is refused before it reaches any handler", () => {

  const post = backendSource.slice(backendSource.indexOf("export async function backendPost"));

  const refusal = post.indexOf("The demo is read-only.");
  const realCall = post.indexOf('invoke({ method: "POST"');

  assert.ok(refusal > 0, "the refusal must exist");
  assert.ok(
    refusal < realCall,
    "and it must come before invoke() — read-only enforced by hiding buttons is decoration"
  );

});


test("the demo session is decided by the cookie, not by an env var", () => {

  // POS_FIXTURES is a process-wide switch for the local design preview and is
  // never set in a deployed build. The demo has to work per-REQUEST on the
  // same production process that serves the real session, so it must key off
  // the request's cookie.
  assert.match(backendSource, /get\("pos_session"\)\?\.value === DEMO_SESSION/);

});


test("login checks the real passphrase before the demo one", () => {

  // If SITE_PASSPHRASE were ever literally "demo", the owner must get a real
  // session — strict equality on the real secret wins first.
  const action = loginSource.slice(
    loginSource.indexOf("async function login"),
    loginSource.indexOf("export default")
  );

  const real = action.indexOf("passphrase === process.env.SITE_PASSPHRASE");
  const demo = action.indexOf("=== DEMO_SESSION");

  assert.ok(real > 0 && demo > 0, "both checks must exist");
  assert.ok(real < demo, "the real passphrase is checked first");

});


test("a demo session expires faster than a real one", () => {

  // 180 days for the owner; a day for a stranger. The magic numbers are the
  // contract, so they are asserted as written.
  assert.match(loginSource, /maxAge: 60 \* 60 \* 24 \* 180/);
  assert.match(loginSource, /maxAge: 60 \* 60 \* 24\n/);

});


test("the demo cookie is set to the constant, never to user input", () => {

  // The input is compared case-insensitively ("Demo " should work), but what
  // goes INTO the cookie is the canonical constant — a cookie holding raw
  // user input is a cookie whose value nobody can reason about.
  assert.match(loginSource, /cookieStore\.set\("pos_session", DEMO_SESSION/);
  assert.doesNotMatch(
    loginSource,
    /cookieStore\.set\("pos_session", passphrase/,
    "raw input must never become the session value"
  );

});
