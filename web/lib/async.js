// Bounded-concurrency map. Preserves input order in the returned array.
//
// Every multi-item loop in this codebase used to run strictly one at a time,
// which is what made buildPlan take ~23s for a 30-task plan and blow Vercel's
// limit. These are independent network calls, so a small pool is the fix —
// small, not unbounded, to stay well inside Google's and OpenAI's per-user
// rate limits and to avoid hammering Supabase with a burst.
//
// Note: this rejects on the first error, like Promise.all. Callers that want
// to collect per-item failures (syncCanvas, nudges) keep their own try/catch
// inside the callback, exactly as they did when they were for-loops.

export const DEFAULT_CONCURRENCY = 4;


export async function mapWithConcurrency(items, fn, limit = DEFAULT_CONCURRENCY) {

  const list = Array.from(items || []);

  const results = new Array(list.length);

  let cursor = 0;


  const workers = Array.from(
    { length: Math.min(limit, list.length) },
    async () => {

      while (true) {

        const index = cursor++;

        if (index >= list.length) return;

        results[index] = await fn(list[index], index);

      }

    }
  );


  await Promise.all(workers);


  return results;

}


// Collapses identical concurrent work into one call.
//
// Not a cache: nothing is retained after the promise settles, so there is no TTL
// to tune, no staleness and nothing to invalidate. It only answers the question
// "somebody else is already asking exactly this, right now — wait for their
// answer instead of asking again."
//
// Two places needed it, and both were invisible until the network calls were
// counted:
//
//   * /settings issued 46 Supabase round trips, 12 of them literal duplicates.
//     buildDiagnostics() counts every table and checkMigrations() probes many of
//     the same tables with the byte-identical query, and they run inside one
//     Promise.all — so both were always in flight together.
//
//   * getSettings() and getProfile() cache for 60s, but a cold container that
//     gets several concurrent callers has every one of them miss, and every one
//     of them query, before the first response populates the cache. A TTL cache
//     without this is a cache that does nothing on exactly the request that
//     needed it most — the first one.
//
// `key` must describe the work completely. Two different questions sharing a key
// would get one answer, which is a far worse bug than the duplication this
// removes.
export function coalesce(map, key, produce) {

  const existing = map.get(key);

  if (existing) return existing;

  // Deleted in a .finally rather than after an await, so a rejection cannot
  // leave a permanently poisoned entry that replays the same failure forever.
  const promise = Promise.resolve()
    .then(produce)
    .finally(() => map.delete(key));

  map.set(key, promise);

  return promise;

}
