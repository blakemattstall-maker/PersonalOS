import { google } from "googleapis";
import { supabase } from "./supabase";

export async function getGoogleClient() {

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

  return oauth2Client;
}