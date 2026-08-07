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

  cachedClient = oauth2Client;
  cachedClientAt = Date.now();

  return { auth: oauth2Client, google };
}