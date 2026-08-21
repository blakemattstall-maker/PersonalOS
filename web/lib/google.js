import { supabase } from "./supabase.js";

// The OAuth2 client refreshes its own access token when one expires, so it's
// meant to be reused. Rebuilding it per operation cost a Supabase read plus a
// fresh token exchange with Google every single time — the dominant term in
// every multi-item loop in this codebase.
//
// Module scope means "per warm serverless container", so this is naturally
// bounded; the TTL just caps how long a re-authorization takes to be noticed.
let cachedClient = null;
let cachedClientAt = 0;

const CLIENT_TTL_MS = 5 * 60 * 1000;

// googleapis is the heaviest dependency in this project. A static top-level
// `import { google } from "googleapis"` in any file means every request that
// merely imports that file — even one that never touches Google — pays to
// load it. Every caller of getGoogleClient() needs the `google` namespace
// immediately after, so it's loaded here, lazily, once per warm container,
// and handed back alongside the auth client instead of being imported
// statically in every tools/google*.js file.
let googleNamespace = null;

async function loadGoogleNamespace() {
  if (!googleNamespace) {
    googleNamespace = (await import("googleapis")).google;
  }
  return googleNamespace;
}


export function clearGoogleClientCache() {
  cachedClient = null;
  cachedClientAt = 0;
}


// Everything this system is allowed to ask Google for. Lives here rather than
// in the auth handler so lib code (diagnostics) can compare what a live token
// actually carries against what the app needs without importing an app route.
//
// Adding a scope here does NOT retroactively grant it. Google issues a
// refresh token scoped to whatever was consented to at the time, so the stored
// token keeps working for exactly the old scopes and every call needing a new
// one fails with "insufficient authentication scopes" until /api/auth/google/
// login is visited again. `prompt: "consent"` in the login step is what makes
// that revisit actually re-issue a token rather than silently bouncing back
// with the old grant — without it, re-authorising appears to succeed and
// changes nothing.
export const SCOPES = [

  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar",

  // Drafts only. This scope technically also permits sending, because Google
  // does not publish a compose-without-send scope — the guarantee that nothing
  // is ever sent is enforced in code (tools/gmail.js touches drafts.create and
  // nothing else) and locked down by a test that fails the build if any send
  // call appears anywhere in the repo.
  "https://www.googleapis.com/auth/gmail.compose",

  // Reading the inbox. Verified against the live token that gmail.compose does
  // NOT cover this — messages.list returns 403 "insufficient authentication
  // scopes" — so this genuinely requires a fresh consent pass, unlike the Docs
  // and Drive scopes which the pre-existing token turned out to already carry.
  //
  // readonly rather than gmail.metadata, and the difference is not incidental:
  // the metadata scope returns headers but strips snippets, and a subject line
  // with no snippet is rarely enough to tell a real commitment from a
  // newsletter. This is broad — it can read everything — so tools/gmail.js
  // deliberately requests format: "metadata" and never fetches message bodies.
  "https://www.googleapis.com/auth/gmail.readonly",

  // Creating and writing documents.
  "https://www.googleapis.com/auth/documents",

  // Deliberately drive.file and not drive: per-file access limited to files
  // this app itself created. It cannot see, read, or touch anything else in
  // Drive. Needed so an exported doc can be given a shareable link.
  "https://www.googleapis.com/auth/drive.file"

];


// What every surface shows when the stored refresh token is dead. One string,
// so the brief, the capture reply, the task error and the diagnostics panel
// all tell him the same thing instead of four spellings of `invalid_grant`.
export const GOOGLE_RECONNECT_MESSAGE =
  "Google connection expired — open Settings and tap Reconnect Google. " +
  "Calendar, tasks, Gmail and Docs are all down until then.";


// `invalid_grant` is Google's word for "the refresh token itself is dead" —
// revoked, or expired by the 7-day lifetime a Testing-status OAuth app puts on
// every token it issues (trap #25). It is a different animal from a scope
// error, a network blip or a disabled API: no retry fixes it, only a fresh
// consent pass does. The shape check is belt-and-braces because the
// google-auth-library surfaces it either as a Gaxios response body or folded
// into the message, depending on which call tripped it.
export function isAuthRevoked(error) {

  if (!error) return false;

  if (error.code === "GOOGLE_AUTH_EXPIRED") return true;

  const grant = error.response?.data?.error;
  const message = String(error.message || "");

  return grant === "invalid_grant"
    || message.includes("invalid_grant")
    || message.includes("Token has been expired or revoked");

}


// One push a day, not one per failed cron. Dedupe state lives in
// activity_logs because module scope evaporates with the container — and the
// row is claimed BEFORE the push is attempted, so a push failure costs one
// missed reminder rather than the reverse order's notification per Google
// call. Never throws: the caller is already in the middle of throwing the
// error that matters.
const ALERT_DEDUPE_MS = 20 * 60 * 60 * 1000;

async function alertAuthExpired() {

  try {

    const { data } = await supabase
      .from("activity_logs")
      .select("created_at")
      .eq("action", "google_auth_alert")
      .order("created_at", { ascending: false })
      .limit(1);

    const lastAt = data?.[0]?.created_at ? new Date(data[0].created_at).getTime() : 0;

    if (Date.now() - lastAt < ALERT_DEDUPE_MS) return;

    await supabase.from("activity_logs").insert({
      action: "google_auth_alert",
      input: null,
      output: { reason: "invalid_grant" },
      success: true,
      source: "system"
    });

    // Filed as well as pushed. A swiped notification must not be the only
    // record that every Google feature is down.
    await supabase.from("prompts").insert([{
      kind: "digest",
      title: "Google connection expired",
      body: "Calendar, tasks, Gmail and Docs are down until you reconnect. Open Settings and tap Reconnect Google — about twenty seconds.",
      status: "pending"
    }]);

    const { sendPush } = await import("./push.js");

    await sendPush({
      title: "Google connection expired",
      body: "Calendar, tasks, Gmail and Docs are down until you reconnect. Settings → Reconnect Google — about twenty seconds.",
      url: "/settings",
      tag: "google-auth"
    });

  } catch (error) {

    console.error("GOOGLE AUTH ALERT FAILED (the expiry itself is still thrown):", error?.message);

  }

}


export async function getGoogleClient() {

  const google = await loadGoogleNamespace();

  if (cachedClient && Date.now() - cachedClientAt < CLIENT_TTL_MS) {
    return { auth: cachedClient, google };
  }

  const { data, error } = await supabase
    .from("google_integrations")
    .select("*")
    .eq("provider", "google")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw new Error("No Google connection found");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: data.refresh_token
  });

  // Prove the token before caching or handing it out. The client would have
  // made this exact refresh round trip lazily on the first API call anyway, so
  // this moves the cost, it doesn't add one — and it turns "every Google
  // feature fails separately with a bare invalid_grant" into one typed error,
  // thrown from one place, carrying words a person can act on. It also means a
  // dead client is never cached: the moment he reconnects, the very next call
  // re-reads the row and picks up the fresh token instead of serving the
  // corpse for another TTL.
  //
  // (A token revoked mid-TTL still surfaces raw at the API call site for up to
  // five minutes — the cached client was proven at cache time. The next cold
  // path catches it here.)
  try {

    await oauth2Client.getAccessToken();

  } catch (error) {

    if (!isAuthRevoked(error)) throw error;

    clearGoogleClientCache();

    await alertAuthExpired();

    const expired = new Error(GOOGLE_RECONNECT_MESSAGE);
    expired.code = "GOOGLE_AUTH_EXPIRED";
    throw expired;

  }

  cachedClient = oauth2Client;
  cachedClientAt = Date.now();

  return { auth: oauth2Client, google };
}
