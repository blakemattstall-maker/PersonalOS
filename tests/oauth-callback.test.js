import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
