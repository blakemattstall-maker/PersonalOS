import { createClient } from "@supabase/supabase-js";


// The client is built on first use, not at module load.
//
// It used to be constructed at module scope, which meant `createClient` ran the
// instant anything in the data layer was imported. Two consequences, one of
// them the reason this project had no tests for its first four days:
//
// 1. Importing ANY file that transitively reaches Supabase — which is nearly
//    every file — threw "supabaseUrl is required." without a full production
//    environment. The module graph was untestable by construction, so the
//    traps documented as having "already bitten, twice" could never be
//    encoded as regression tests.
//
// 2. In production a missing or misspelled env var crashed the whole
//    serverless function at cold start, before any handler ran, surfacing as
//    an opaque 500 with no indication of which variable was wrong.
//
// Deferring construction fixes both and changes nothing about behaviour: the
// client is still a process-wide singleton, still built from the service key,
// still created exactly once. Call sites are untouched — the proxy below
// forwards every property access to the real client, so `supabase.from(...)`
// works exactly as it always did.
//
// NOTE: the service key bypasses Row Level Security. That is correct for a
// single-user, server-only system, and it is also the seam where per-user
// scoping goes when a second user ever exists — see §1.1 and §2 Tier 1.1 of
// docs/PersonalOS-Premortem.md. Nothing outside this file should ever call
// createClient directly.

let client = null;


export function getSupabase() {

  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {

    throw new Error(
      `Supabase is not configured: ${!url ? "SUPABASE_URL" : "SUPABASE_SERVICE_KEY"} is missing. ` +
      "Set it in the Vercel project (or .env.local for a local run)."
    );

  }

  client = createClient(url, key);

  return client;

}


// Test seam. Used only by the suite, so a test can change env vars between
// cases without a stale client surviving.
export function resetSupabaseClient() {
  client = null;
}


// Everything in the codebase does `supabase.from("table")`. This forwards that
// to the real client, constructing it on the first property access rather than
// on import.
export const supabase = new Proxy({}, {

  get(_target, property) {

    const value = getSupabase()[property];

    return typeof value === "function" ? value.bind(getSupabase()) : value;

  }

});


export default supabase;
