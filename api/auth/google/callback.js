import { google } from "googleapis";
import { supabase } from "../../../lib/supabase";

export default async function handler(req, res) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);

    const { data, error } = await supabase
      .from("google_integrations")
      .upsert(
        {
          provider: "google",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(tokens.expiry_date)
        },
        {
          onConflict: "provider"
        }
      )
      .select();

    if (error) {
      return res.status(500).json({
        step: "supabase upsert",
        error
      });
    }

    return res.json({
      message: "Google connected and updated",
      data
    });

  } catch (error) {
    return res.status(500).json({
      step: "callback",
      error: error.message
    });
  }
}