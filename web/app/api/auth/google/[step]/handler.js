import { google } from "googleapis";
import { supabase } from "../../../../../lib/supabase.js";


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


// Adding a scope here does NOT retroactively grant it. Google issues a
// refresh token scoped to whatever was consented to at the time, so the stored
// token keeps working for exactly the old scopes and every call needing a new
// one fails with "insufficient authentication scopes" until /api/auth/google/
// login is visited again. `prompt: "consent"` below is what makes that revisit
// actually re-issue a token rather than silently bouncing back with the old
// grant — without it, re-authorising appears to succeed and changes nothing.
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


function client() {

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

}


function login(req, res) {

  const url = client().generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });

  return res.redirect(url);

}


async function callback(req, res) {

  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code." });
  }

  const { tokens } = await client().getToken(code);

  const { data, error } = await supabase
    .from("google_integrations")
    .upsert(
      {
        provider: "google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expiry_date)
      },
      { onConflict: "provider" }
    )
    .select();

  if (error) {
    return res.status(500).json({ step: "supabase upsert", error });
  }

  // Report what was actually granted rather than just "connected". Google
  // silently drops any scope the user unticks on the consent screen, and the
  // failure that causes shows up much later as a confusing 403 from an
  // unrelated feature — this makes a partial grant visible immediately.
  const granted = (tokens.scope || "").split(" ").filter(Boolean);
  const missing = SCOPES.filter(s => !granted.includes(s));

  return res.json({
    message: missing.length === 0
      ? "Google connected — all scopes granted."
      : "Google connected, but some scopes were NOT granted. The features needing them will fail until you re-authorise and accept everything.",
    granted,
    missing,
    data
  });

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
