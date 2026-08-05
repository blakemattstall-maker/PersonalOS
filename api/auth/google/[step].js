import { google } from "googleapis";
import { supabase } from "../../../lib/supabase.js";


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
    scope: [
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/calendar"
    ],
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

  return res.json({ message: "Google connected and updated", data });

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
