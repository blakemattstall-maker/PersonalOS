import supabase from "./supabase.js";


// Server-side settings — only the ones a background job has to read.
//
// The split matters. Reading voice, speech rate, autoplay and theme are
// decisions the *browser* acts on, so they live in localStorage: they need no
// round trip, they survive the backend being down, and storing them here would
// buy nothing. What has to be here is anything the cron consults while the user
// is asleep — chiefly how much this app is allowed to interrupt them.
//
// `app_settings` may not exist yet (Supabase DDL can't be run from code, so new
// tables are pasted in by hand). Every read falls back to the defaults and every
// write reports that it didn't stick, rather than throwing — a missing table
// must not take the dashboard down.

const TABLE = "app_settings";

const CACHE_TTL_MS = 60_000;

let cache = null;
let cachedAt = 0;


export const DEFAULTS = {
  // silent            — never push, dashboard only
  // digest            — the daily digest, nothing else
  // digest_plus_urgent— the agreed default: one digest + genuinely urgent things
  // everything        — push anything the observer thinks is worth saying
  interruption_level: "digest_plus_urgent"
};


export const INTERRUPTION_LEVELS = [
  "silent",
  "digest",
  "digest_plus_urgent",
  "everything"
];


function missingTable(error) {
  // PostgREST reports an unknown table as PGRST205 rather than a Postgres code.
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}


export function clearSettingsCache() {
  cache = null;
  cachedAt = 0;
}


export async function getSettings() {

  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  const { data, error } = await supabase
    .from(TABLE)
    .select("key, value");

  if (error) {

    if (!missingTable(error)) {
      console.error("SETTINGS READ FAILED:", error.message);
    }

    return { ...DEFAULTS, persisted: false };

  }

  const stored = Object.fromEntries((data || []).map(r => [r.key, r.value]));

  cache = { ...DEFAULTS, ...stored, persisted: true };
  cachedAt = Date.now();

  return cache;

}


export async function saveSettings(patch) {

  const rows = Object.entries(patch || {})
    .filter(([key]) => key in DEFAULTS)
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));

  if (rows.length === 0) {
    return { success: false, error: "Nothing recognised to save." };
  }

  const { error } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: "key" });

  if (error) {

    if (missingTable(error)) {
      return {
        success: false,
        persisted: false,
        error: "The app_settings table doesn't exist yet — run docs/schema-settings.sql in Supabase."
      };
    }

    return { success: false, error: error.message };

  }

  clearSettingsCache();

  return { success: true, persisted: true, saved: rows.map(r => r.key) };

}


// One place that answers "may the app push right now, for this kind of thing".
// `urgency` is "digest" for the once-a-day summary, "urgent" for time-sensitive
// one-offs (a large charge, something due today).
export async function pushAllowed(urgency = "digest") {

  const { interruption_level } = await getSettings();

  if (interruption_level === "silent") return false;
  if (interruption_level === "everything") return true;
  if (interruption_level === "digest") return urgency === "digest";

  return urgency === "digest" || urgency === "urgent";

}
