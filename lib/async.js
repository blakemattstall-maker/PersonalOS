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
