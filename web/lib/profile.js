import supabase from "./supabase.js";
import { coalesce } from "./async.js";


// Where the user actually is, used only when the profile row cannot be read.
//
// Exported because it was not, and three files had quietly disagreed about it:
// this one said America/Los_Angeles while lib/signals.js and tools/location.js
// each hardcoded their own America/Chicago. A Supabase blip therefore resolved
// dates in one zone for the brief and another for the signals feeding it, with no
// error anywhere — §1 of the pre-mortem flags exactly this. One constant now, and
// nothing else is allowed a literal.
//
// Chicago as of 2026-08-08. If this moves again, the Vercel cron schedules in
// web/vercel.json are UTC and do NOT follow it — tests/api-routes.test.js checks
// them against this value so the two cannot drift apart silently.
export const FALLBACK_TIMEZONE = "America/Chicago";


// The profile row is read constantly — getUserTimezone() alone is called by
// nearly every tool, and buildRichContext() used to fetch the whole row twice
// in one pass. It changes maybe once a year, so a short TTL collapses all of
// that to a single query without making edits feel stale (a timezone change
// takes effect within a minute).
let cachedProfile = null;
let cachedProfileAt = 0;

const PROFILE_TTL_MS = 60 * 1000;

// The TTL above is what makes the row cheap on a warm container. This is what
// makes it cheap on a cold one: until the first read comes back there is nothing
// cached, so every concurrent caller misses and every one of them queries. The
// request that most needed the cache was the only request it did nothing for.
// buildRichContext() fans out to several tools at once and each of them calls
// getUserTimezone(), so the stampede was as wide as the fan-out.
const inFlight = new Map();


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

  return coalesce(inFlight, "profile", async () => {

    // Re-checked inside the coalesced body: a caller that queued behind an
    // in-flight read gets the cache the moment it lands, rather than being
    // handed a result computed before it arrived.
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

  });

}



export async function getUserTimezone() {

  const profile = await getProfile();

  return profile?.timezone || FALLBACK_TIMEZONE;

}



export async function getProfileBio() {

  const profile = await getProfile();

  return profile?.bio || null;

}