import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { isAuthRevoked, GOOGLE_RECONNECT_MESSAGE, SCOPES } from "../web/lib/google.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


// ---------------------------------------------------------------------------
// Trap #25: a Google OAuth app left in "Testing" issues refresh tokens that
// die after exactly seven days. When it happened, every Google feature failed
// separately with a bare `invalid_grant` and nothing anywhere said what to do.
// These tests pin the machinery that turns that into one typed failure, one
// daily notification, and a reconnect button that knows why it exists.
// ---------------------------------------------------------------------------


test("invalid_grant is recognised in every shape the auth library throws it", () => {

  // The Gaxios shape: refresh failures carry the OAuth error body.
  assert.equal(isAuthRevoked({ response: { data: { error: "invalid_grant" } } }), true);

  // The folded-into-message shapes.
  assert.equal(isAuthRevoked(new Error("invalid_grant")), true);
  assert.equal(isAuthRevoked(new Error("Token has been expired or revoked.")), true);

  // Already-translated errors keep classifying, so a caller catching the typed
  // error can re-ask the same question without string matching.
  const translated = new Error(GOOGLE_RECONNECT_MESSAGE);
  translated.code = "GOOGLE_AUTH_EXPIRED";
  assert.equal(isAuthRevoked(translated), true);

});


test("everything that is not a dead token stays untranslated", () => {

  // A scope gap, a network blip and a disabled API are NOT fixed by
  // reconnecting — telling him to re-consent for these would send him through
  // the flow to land on the same error.
  assert.equal(isAuthRevoked(new Error("insufficient authentication scopes")), false);
  assert.equal(isAuthRevoked(new Error("ECONNRESET")), false);
  assert.equal(isAuthRevoked({ response: { data: { error: "invalid_client" } } }), false);
  assert.equal(isAuthRevoked(null), false);
  assert.equal(isAuthRevoked(undefined), false);

});


test("the reconnect message names the fix, not the error code", () => {

  assert.match(GOOGLE_RECONNECT_MESSAGE, /Settings/);
  assert.match(GOOGLE_RECONNECT_MESSAGE, /Reconnect/i);
  assert.doesNotMatch(GOOGLE_RECONNECT_MESSAGE, /invalid_grant/);

});


test("the token is proven before the client is cached", () => {

  // A client cached before its token is proven serves the corpse for a full
  // TTL after a reconnect; proven-then-cached means the next call after a
  // reconnect re-reads the row and just works.
  const source = read("web/lib/google.js");

  const proves = source.indexOf("getAccessToken()");
  const caches = source.indexOf("cachedClient = oauth2Client");

  assert.ok(proves > 0, "getGoogleClient must force the refresh round trip itself");
  assert.ok(caches > proves, "the cache assignment must come after the token is proven");

  // And the typed error carries the code every caller branches on.
  assert.match(source, /GOOGLE_AUTH_EXPIRED/);

});


test("the daily alert claims its dedupe slot before attempting the push", () => {

  // Claim-then-push costs one missed reminder if the push fails; push-then-
  // claim costs one notification per Google call in the system until it
  // succeeds. The order is the feature.
  const source = read("web/lib/google.js");
  const alert = source.slice(source.indexOf("async function alertAuthExpired"));

  const claim = alert.indexOf('insert({');
  const push = alert.indexOf("sendPush(");

  assert.ok(claim > 0 && push > claim, "the activity_logs claim must precede sendPush");

});


test("the auth handler consents to exactly the scopes the app declares", () => {

  // SCOPES moved to lib/google.js so diagnostics can compare a live token
  // against it. The handler must consume that list, not keep a private copy
  // that silently drifts.
  const handler = read("web/app/api/auth/google/[step]/handler.js");

  assert.match(handler, /import \{ SCOPES \} from/);
  assert.doesNotMatch(handler, /export const SCOPES/);

  // The list itself still carries everything the tools call.
  for (const scope of ["tasks", "calendar", "gmail.compose", "gmail.readonly", "documents", "drive.file"]) {
    assert.ok(
      SCOPES.includes(`https://www.googleapis.com/auth/${scope}`),
      `SCOPES must still include ${scope}`
    );
  }

});


test("the brief names the dead connection instead of shrugging three times", () => {

  const brief = read("web/tools/brief.js");

  // gatherBriefFacts must notice the typed code, and renderFacts must hand the
  // model the cause-and-fix line rather than three unrelated "unavailable"s.
  assert.match(brief, /GOOGLE_AUTH_EXPIRED/);
  assert.match(brief, /googleAuthExpired/);
  assert.match(brief, /Reconnect Google/);

});


test("diagnostics probes the token live rather than trusting the row", () => {

  const diagnostics = read("web/lib/diagnostics.js");

  assert.match(diagnostics, /getGoogleClient\(\)/, "the probe must go through the same choke point the tools use");
  assert.match(diagnostics, /missingScopes/, "a partial consent must be visible, not just a dead one");

});
