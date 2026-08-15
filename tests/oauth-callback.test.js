import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { redirectUriFor } from "../web/app/api/auth/google/[step]/handler.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const oauthSource = read("web/app/api/auth/google/[step]/handler.js");


// ---------------------------------------------------------------------------
// The Google OAuth flow reads and writes ONE shared row — the single account
// the whole system acts through. If a stranger can complete consent with their
// own account, they own the owner's calendar, tasks, drafts and inbox. These
// tests guard the gate that stops that.
// ---------------------------------------------------------------------------

test("both OAuth steps require the owner session", () => {

  assert.match(oauthSource, /function isOwner/);

  // The gate must be invoked at the top of BOTH steps, or the unguarded one is
  // the whole hole. login bounces to Google; callback writes the token.
  const login = oauthSource.slice(oauthSource.indexOf("function login"), oauthSource.indexOf("async function callback"));
  const callback = oauthSource.slice(oauthSource.indexOf("async function callback"));

  assert.match(login, /if \(!isOwner\(req\)\)/, "login must refuse a non-owner");
  assert.match(callback, /if \(!isOwner\(req\)\)/, "callback must refuse a non-owner");

  // And the callback's owner check must precede the token write, not follow it.
  const check = callback.indexOf("isOwner(req)");
  const write = callback.indexOf("google_integrations");
  assert.ok(check > 0 && check < write, "the owner check must run before the upsert");

});


test("the OAuth gate fails closed when the passphrase is unset", () => {

  // A token-swap gate that evaporates with a missing env var is the "Bearer
  // undefined" trap reborn — an unset secret must never be satisfiable.
  const isOwner = oauthSource.slice(oauthSource.indexOf("function isOwner"), oauthSource.indexOf("function login"));
  assert.match(isOwner, /if \(!passphrase\)/);
  assert.match(isOwner, /return false/);
  assert.match(isOwner, /pos_session=/);

});


test("the callback returns error.message, never the raw error object", () => {

  // The raw PostgREST error object leaks schema and column detail to the
  // browser; every other handler returns the message only.
  assert.match(oauthSource, /error: error\.message/);
  assert.doesNotMatch(oauthSource, /json\(\{ step: "supabase upsert", error \}\)/);

});


// ---------------------------------------------------------------------------
// Trap #26: GOOGLE_REDIRECT_URI reached production still pointing at
// localhost:3000, marked Sensitive so the value couldn't even be read back —
// and the phone's reconnect flow bounced to a dev server that wasn't there.
// The redirect URI must follow the host the request arrived on, because that
// host is where the owner cookie lives and where Google must land the browser.
// ---------------------------------------------------------------------------

const onHost = (host) => ({ headers: { host } });

const withEnv = (value, fn) => {
  const before = process.env.GOOGLE_REDIRECT_URI;
  if (value === undefined) delete process.env.GOOGLE_REDIRECT_URI;
  else process.env.GOOGLE_REDIRECT_URI = value;
  try { return fn(); }
  finally {
    if (before === undefined) delete process.env.GOOGLE_REDIRECT_URI;
    else process.env.GOOGLE_REDIRECT_URI = before;
  }
};


test("a dev redirect URI in the env cannot capture a production request", () => {

  // The bug as it shipped: prod env carried the localhost value, the phone
  // started the flow on the real domain, and Google sent it to localhost.
  withEnv("http://localhost:3000/api/auth/google/callback", () => {
    assert.equal(
      redirectUriFor(onHost("www.getalmanac.xyz")),
      "https://www.getalmanac.xyz/api/auth/google/callback"
    );
  });

});


test("local development keeps its localhost redirect", () => {

  withEnv("http://localhost:3000/api/auth/google/callback", () => {
    assert.equal(
      redirectUriFor(onHost("localhost:3000")),
      "http://localhost:3000/api/auth/google/callback"
    );
  });

});


test("an explicitly pinned production URI still wins on production", () => {

  withEnv("https://www.getalmanac.xyz/api/auth/google/callback", () => {
    assert.equal(
      redirectUriFor(onHost("web-liart-two-12.vercel.app")),
      "https://www.getalmanac.xyz/api/auth/google/callback"
    );
  });

});


test("no env var at all derives from the request, with the right scheme", () => {

  withEnv(undefined, () => {
    assert.equal(
      redirectUriFor(onHost("www.getalmanac.xyz")),
      "https://www.getalmanac.xyz/api/auth/google/callback"
    );
    assert.equal(
      redirectUriFor(onHost("localhost:3000")),
      "http://localhost:3000/api/auth/google/callback"
    );
  });

});


test("a forwarded host outranks the direct one", () => {

  // Behind the old domain's /api/* rewrite the serving host is not the host
  // the person is on; x-forwarded-host is.
  withEnv(undefined, () => {
    assert.equal(
      redirectUriFor({ headers: { "x-forwarded-host": "www.getalmanac.xyz", host: "web-liart-two-12.vercel.app" } }),
      "https://www.getalmanac.xyz/api/auth/google/callback"
    );
  });

});


test("both halves of the handshake build the client from the request", () => {

  // The token exchange sends redirect_uri again and Google rejects the code if
  // it differs from the one consent was granted under — so neither step may
  // fall back to a bare client().
  assert.match(oauthSource, /client\(req\)\.generateAuthUrl/);
  assert.match(oauthSource, /client\(req\)\.getToken/);
  assert.doesNotMatch(oauthSource, /client\(\)\./);

});
