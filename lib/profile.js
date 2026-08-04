import supabase from "./supabase.js";


const FALLBACK_TIMEZONE = "America/Los_Angeles";


// Single source of truth for profile lookups.
// When multi-user arrives, this is the only function that changes.
export async function getProfile() {

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .limit(1)
    .single();


  if (error) {
    console.error("PROFILE LOOKUP FAILED:", error.message);
    return null;
  }


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