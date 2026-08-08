import supabase from "./supabase.js";
import { coalesce } from "./async.js";


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

const inFlight = new Map();


export const DEFAULTS = {
  // silent            — never push, dashboard only
  // digest            — the daily digest, nothing else
  // digest_plus_urgent— the agreed default: one digest + genuinely urgent things
  // everything        — push anything the observer thinks is worth saying
  interruption_level: "digest_plus_urgent",

  // Whether a newly created Google Calendar event is coloured by what kind of
  // thing it is (lib/eventKind.js's classifyEvent) rather than the flat
  // default. On by default because sorting by kind is the whole point; a
  // request that names an explicit colour always wins over this regardless of
  // the setting.
  auto_color_events: true,

  // Which colour each kind gets, when the above is on. Empty means "use
  // KIND_COLOR from lib/eventKind.js", so the shipped mapping stays the
  // default and this only ever holds the kinds actually overridden — a
  // half-filled object here would otherwise silently freeze the rest of the
  // defaults at whatever they were the day it was written.
  event_colors: {}
};


export const INTERRUPTION_LEVELS = [
  "silent",
  "digest",
  "digest_plus_urgent",
  "everything"
];


// The dial is ordered, so "may I push this?" is a comparison rather than a
// chain of equality checks. Rank exists only for that comparison.
const LEVEL_RANK = {
  silent: 0,
  digest: 1,
  digest_plus_urgent: 2,
  everything: 3
};


// Every kind of interruption this app can raise, and the lowest dial setting at
// which it is allowed to reach the phone.
//
// This table used to be implicit, and that was the bug. `pushAllowed()` only
// ever compared against the literal strings "digest" and "urgent", while real
// call sites were passing "nudge" and "relationship_checkin" — which matched
// nothing, and so meant "never push" at two of the four levels. The behaviour
// happened to be right (a nudge genuinely is not urgent, and the agreed budget
// is one digest a day plus urgent only), but nothing said so, and any typo'd
// urgency string would have been silently suppressed in exactly the same way.
//
// Add a new kind of push here or it will not be deliverable. That is
// deliberate: an interruption nobody classified should fail loudly at review
// time, not quietly on someone's phone.
export const URGENCY_TIERS = {
  // The once-a-day summary — the morning brief and the daily observation.
  digest: "digest",
  // Genuinely time-sensitive and worth breaking the budget for.
  urgent: "digest_plus_urgent",
  // The app initiating something that is not time-critical.
  nudge: "everything",
  relationship_checkin: "everything",
  // Something the graph noticed that no single domain could have. Tiered with
  // nudges: valuable, but never urgent.
  insight: "everything",

  // The reply to something he just did. Tiered at "digest" — the lowest
  // setting that pushes at all — because this is not the app interrupting him,
  // it is the app answering him, and since the Shortcut went silent it is the
  // only answer a capture gets. Still gated rather than unconditional: silent
  // has to mean silent, or the dial is a suggestion.
  capture_confirmation: "digest"
};


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

  // Same reasoning as lib/profile.js: the TTL only helps once something is in
  // it, so concurrent callers on a cold container all missed and all queried.
  // /settings did exactly that — the page reads settings while buildDiagnostics()
  // reads them again inside the same Promise.all, so app_settings was fetched
  // twice on every single visit.
  return coalesce(inFlight, "settings", async () => {

    if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

    const { data, error } = await supabase
      .from(TABLE)
      .select("key, value");

    if (error) {

      if (!missingTable(error)) {
        console.error("SETTINGS READ FAILED:", error.message);
      }

      // Deliberately not cached: this is the "table isn't there yet" fallback,
      // and caching it would keep serving defaults for a minute after the
      // migration is finally applied.
      return { ...DEFAULTS, persisted: false };

    }

    const stored = Object.fromEntries((data || []).map(r => [r.key, r.value]));

    cache = { ...DEFAULTS, ...stored, persisted: true };
    cachedAt = Date.now();

    return cache;

  });

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
// `urgency` must be a key of URGENCY_TIERS — see the note there for why an
// unrecognised one is loud rather than quietly dropped.
export async function pushAllowed(urgency = "digest") {

  const { interruption_level } = await getSettings();

  const required = URGENCY_TIERS[urgency];

  if (!required) {

    // Silently returning false here is what made the old version's mismatch
    // invisible for as long as it was. A misclassified push is a bug in this
    // repo, so say so where someone will see it.
    console.error(
      `pushAllowed: unknown urgency "${urgency}". Add it to URGENCY_TIERS in ` +
      `lib/settings.js. Treating it as the most restrictive tier for now.`
    );

  }

  const need = LEVEL_RANK[required ?? "everything"];

  const have = LEVEL_RANK[interruption_level] ?? LEVEL_RANK[DEFAULTS.interruption_level];

  return have >= need;

}
