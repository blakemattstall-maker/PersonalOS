import { google } from "googleapis";
import { supabase } from "../../../../../lib/supabase.js";
import { SCOPES } from "../../../../../lib/google.js";


// Both halves of the Google OAuth handshake in one function.
//
// The dynamic segment still matches /api/auth/google/login and
// /api/auth/google/callback exactly as two separate files did, so the redirect
// URI registered in the Google Cloud Console does not change and nothing needs
// re-authorising. It is purely two files becoming one, to buy back a slot
// against Vercel's 12-function cap.
//
// Deliberately not behind requireAuth: this is a browser flow. The login step
// only bounces to Google's own consent screen, and the callback is useless
// without a valid one-time code issued to this client ID.
//
// SCOPES lives in lib/google.js now, so diagnostics can compare what the live
// token carries against what the app needs without importing an app route.


// The redirect URI follows the host the request actually arrived on, not the
// env var. GOOGLE_REDIRECT_URI was migrated into production still pointing at
// http://localhost:3000 — and marked Sensitive in Vercel, so the value that
// sent the phone's reconnect flow to a dev server that wasn't there could not
// even be read back to be noticed (trap #26). The request already knows the
// right answer: Google must return the browser to the same host that started
// the flow, because that host is where the owner cookie lives.
//
// The env var still wins when its locality matches the request's — a real
// value pinned for production, or localhost while actually developing on
// localhost — so local consent flows keep working unchanged. Google's side
// only ever honours a redirect URI that is registered on the OAuth client, so
// a derived host that isn't registered fails loudly with redirect_uri_mismatch
// rather than quietly landing somewhere wrong.
//
// Both halves of the handshake must agree: the token exchange in the callback
// sends redirect_uri again, and Google rejects the code if it differs from the
// one consent was granted under. Deriving from the request keeps them agreeing
// by construction — the callback's own host IS the host Google redirected to.
export function redirectUriFor(req) {

  const configured = process.env.GOOGLE_REDIRECT_URI || "";

  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "";

  const requestIsLocal = /^(localhost|127\.)/.test(host);
  const configuredIsLocal = configured.includes("localhost") || configured.includes("127.");

  if (configured && requestIsLocal === configuredIsLocal) return configured;

  return `${requestIsLocal ? "http" : "https"}://${host}/api/auth/google/callback`;

}


function client(req) {

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUriFor(req)
  );

}


// This flow reads and writes ONE shared row (google_integrations, keyed on
// provider) — the single Google account the whole system acts through. Without
// a check here, anyone who can complete this client's consent screen with their
// OWN Google account overwrites that row, and from then on every event, task,
// draft and doc the owner captures is created in the attacker's account while
// the owner's briefs read the attacker's calendar and inbox. The callback is
// outside proxy.js's matcher (it has to be — Google is the caller and holds no
// session), so the gate lives here.
//
// The owner drives this from their logged-in browser, so pos_session rides both
// the login GET and Google's top-level callback redirect (sameSite=lax). An
// attacker has neither. Fail closed if the passphrase is unset: a token-swap
// gate that evaporates when an env var is missing is exactly the trap the cron
// secret already learned (README trap: "Bearer undefined").
function isOwner(req) {

  const passphrase = process.env.SITE_PASSPHRASE;

  if (!passphrase) {
    console.error(
      "OAUTH gate: SITE_PASSPHRASE is unset — refusing the Google flow rather " +
      "than letting an unauthenticated caller overwrite the shared token."
    );
    return false;
  }

  const raw = req.headers?.cookie || "";

  const session = raw
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith("pos_session="))
    ?.slice("pos_session=".length);

  return session === passphrase;

}


function login(req, res) {

  if (!isOwner(req)) {
    return res.status(403).json({ error: "Sign in first — the Google connection is the owner's only." });
  }

  const url = client(req).generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });

  return res.redirect(url);

}


async function callback(req, res) {

  // The consent code is valid, but "valid" only means Google issued it to this
  // client — it says nothing about WHO is holding it. The owner check is what
  // stops a stranger's freshly-consented token landing in the shared row.
  if (!isOwner(req)) {
    return res.status(403).json({ error: "Sign in first — the Google connection is the owner's only." });
  }

  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code." });
  }

  const { tokens } = await client(req).getToken(code);

  // No `.select()` — the row it would return carries the tokens themselves,
  // which have no business round-tripping toward a browser.
  const { error } = await supabase
    .from("google_integrations")
    .upsert(
      {
        provider: "google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expiry_date)
      },
      { onConflict: "provider" }
    );

  if (error) {
    // Message only — the raw PostgREST error object leaks column and schema
    // detail to the browser. Every other handler already returns error.message.
    return res.status(500).json({ step: "supabase upsert", error: error.message });
  }

  // Report what was actually granted rather than just "connected". Google
  // silently drops any scope the user unticks on the consent screen, and the
  // failure that causes shows up much later as a confusing 403 from an
  // unrelated feature — this makes a partial grant visible immediately.
  //
  // The report lands as a redirect back into Settings rather than a raw JSON
  // body, because the person completing this flow is on a phone that just came
  // back from Google's consent screen — a wall of JSON there reads as "did it
  // work?". Settings renders the outcome and its Diagnostics panel re-probes
  // the fresh token on the same load.
  const granted = (tokens.scope || "").split(" ").filter(Boolean);
  const missing = SCOPES.filter(s => !granted.includes(s));

  if (missing.length === 0) {
    return res.redirect(302, "/settings?google=connected");
  }

  const short = missing.map(s => s.replace("https://www.googleapis.com/auth/", ""));

  return res.redirect(302, `/settings?google=partial&missing=${encodeURIComponent(short.join(","))}`);

}


const STEPS = { login, callback };


export default async function handler(req, res) {

  const run = STEPS[req.query.step];

  if (!run) {
    return res.status(404).json({ error: `Unknown auth step: ${req.query.step}` });
  }

  try {

    return await run(req, res);

  } catch (error) {

    return res.status(500).json({ step: req.query.step, error: error.message });

  }

}
