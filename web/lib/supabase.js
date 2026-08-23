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


// PostgREST caps a response at 1000 rows and says nothing about it.
//
// `.limit(5000)` does not raise that cap — it lowers a ceiling that is already
// lower. So a query asking for five thousand rows returns one thousand, with
// no error, no truncation flag and no way to tell a capped result from a
// complete one. That is how a scan quietly stops seeing the oldest half of a
// table while every log line still says success.
//
// This pages through with `.range()` until a short page proves the end was
// reached, and warns rather than truncating silently if a caller's own ceiling
// is hit. Anything that scans a whole table should use it.
export async function selectAll(table, columns, { page = 500, max = 10000, modify = null } = {}) {

  const rows = [];

  for (let from = 0; from < max; from += page) {

    let query = getSupabase().from(table).select(columns).range(from, from + page - 1);

    // Filters and ordering are applied by the caller. Ordering matters more
    // than it looks: `.range()` over an unordered query is not guaranteed to
    // be a stable window, so a row can be returned twice or skipped between
    // pages. Callers should order by something unique.
    if (modify) query = modify(query);

    const { data, error } = await query;

    if (error) return { rows, error };

    rows.push(...(data || []));

    if ((data || []).length < page) return { rows, error: null };

  }

  console.warn(
    `selectAll(${table}) stopped at its ${max}-row ceiling — older rows were not read. ` +
    "Raise `max` or make the caller incremental."
  );

  return { rows, error: null, capped: true };

}


// A bulk upsert where every row carries the same columns.
//
// The second PostgREST trap, and it is quieter than the 1000-row cap because
// it destroys data rather than hiding it.
//
// supabase-js builds the `columns=` parameter from the UNION of the keys across
// every object in the batch (see postgrest-js PostgrestQueryBuilder: values
// .reduce((acc, x) => acc.concat(Object.keys(x)))). PostgREST then inserts all
// of those columns, and a row that lacks one gets NULL — so on a conflict the
// generated `DO UPDATE SET col = EXCLUDED.col` writes that NULL over whatever
// the column held.
//
// Which means a perfectly ordinary conditional key:
//
//     ...(p.deadline ? { deadline: p.deadline } : {})
//
// is safe on a single-row insert and silently destructive in a batch. In the
// jobs poll it wiped every deadline the enrichment pass had read out of a job
// description, on every one of the 96 polls a day where any posting in the same
// batch happened to state a deadline of its own.
//
// The fix is not to fill the gaps — a NULL you wrote on purpose is still a
// NULL. It is to send rows of one shape at a time, so a column nobody in the
// group carries is never named in the write at all.
export function groupByShape(rows) {

  if (!Array.isArray(rows) || rows.length === 0) return [];

  const groups = new Map();

  for (const row of rows) {
    // Sorted, so { a, b } and { b, a } are one group rather than two. NUL as
    // the separator because no column name can contain it.
    const shape = Object.keys(row).sort().join("\u0000");
    if (!groups.has(shape)) groups.set(shape, []);
    groups.get(shape).push(row);
  }

  return [...groups.values()];

}


export async function upsertUniform(table, rows, options = {}) {

  const groups = groupByShape(rows);

  if (groups.length === 0) return { error: null, groups: 0 };

  for (const group of groups) {

    const { error } = await getSupabase().from(table).upsert(group, options);

    // Stop on the first failure rather than pressing on: a partial write across
    // shapes is harder to reason about than a failed one.
    if (error) return { error, groups: groups.length };

  }

  return { error: null, groups: groups.length };

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
