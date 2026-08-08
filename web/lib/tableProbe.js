import supabase from "./supabase.js";
import { coalesce } from "./async.js";


// "How many rows are in this table, and does it exist at all?" — asked from two
// places that had no idea about each other.
//
// lib/diagnostics.js counts fifteen tables to show how much of everything there
// is. lib/schema.js probes for tables to work out which hand-pasted migration
// has actually been run. Both were issuing
//
//   supabase.from(table).select("*", { count: "exact", head: true })
//
// byte for byte, on many of the same tables, from inside the same Promise.all —
// so /settings made 46 Supabase round trips where 34 would do. One of them
// wanted the number and the other only wanted to know whether it errored, which
// is why the overlap was never obvious from either file alone.
//
// The coalescing here is per-flight, not a TTL cache, and that is the point: a
// diagnostics page that showed cached numbers would be lying about exactly the
// thing it exists to report. Nothing is retained once the answer arrives — two
// callers asking at the same instant share one request, and a caller asking a
// second later gets a fresh one.
const inFlight = new Map();


export function probeTable(table) {

  return coalesce(inFlight, table, async () => {

    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    return { count: count ?? 0, error: error || null };

  });

}
