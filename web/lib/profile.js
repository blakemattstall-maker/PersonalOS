import supabase from "./supabase.js";


const FALLBACK_TIMEZONE = "America/Los_Angeles";


// The profile row is read constantly — getUserTimezone() alone is called by
// nearly every tool, and buildRichContext() used to fetch the whole row twice
// in one pass. It changes maybe once a year, so a short TTL collapses all of
// that to a single query without making edits feel stale (a timezone change
// takes effect within a minute).
let cachedProfile = null;
let cachedProfileAt = 0;

const PROFILE_TTL_MS = 60 * 1000;


export function clearProfileCache() {
  cachedProfile = null;
  cachedProfileAt = 0;
}


// Single source of truth for profile lookups.
// When multi-user arrives, this is the only function that changes.
export async function getProfile() {

  if (cachedProfile && Date.now() - cachedProfileAt < PROFILE_TTL_MS) {
    return cachedProfile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .limit(1)
    .single();


  if (error) {
    console.error("PROFILE LOOKUP FAILED:", error.message);
    return null;
  }


  cachedProfile = data;
  cachedProfileAt = Date.now();


  return data;

}



export async function getUserTimezone() {

  const profile = await getProfile();

  return profile?.timezone || FALLBACK_TIMEZONE;

}



export async function getProfileBio() {

  const profile = await getProfile();

  return profile?.bio || null;

}