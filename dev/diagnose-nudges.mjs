// Read-only snapshot of the proactive pipeline's state, for debugging why
// nudges/observer prompts do or don't reach the phone.
//
//   node --env-file=.env.local dev/diagnose-nudges.mjs
//
// Prints counts and recent rows from every table the nudge/brief/observer
// path touches. Touches nothing.

import supabase from "../web/lib/supabase.js";

const trunc = (s, n = 160) => (s || "").replace(/\s+/g, " ").slice(0, n);

async function dump(label, query) {
  const { data, error, count } = await query;
  console.log(`\n===== ${label}${count != null ? ` (total ${count})` : ""} =====`);
  if (error) return console.log("ERROR:", error.message);
  for (const row of data || []) {
    const copy = { ...row };
    for (const k of ["content", "message", "body"]) {
      if (copy[k]) copy[k] = trunc(copy[k], k === "content" ? 300 : 160);
    }
    console.log(JSON.stringify(copy));
  }
}

await dump("nudges (latest)", supabase
  .from("nudges")
  .select("id,message,status,created_at,deliver_at,pushed_at", { count: "exact" })
  .order("created_at", { ascending: false })
  .limit(12));

await dump("intentions open", supabase
  .from("intentions")
  .select("id,content,status,created_at,last_surfaced_at", { count: "exact" })
  .eq("status", "open")
  .order("created_at", { ascending: false })
  .limit(12));

await dump("prompts (observer digests etc.)", supabase
  .from("prompts")
  .select("id,kind,title,body,status,created_at,pushed_at", { count: "exact" })
  .order("created_at", { ascending: false })
  .limit(12));

await dump("briefs (latest)", supabase
  .from("briefs")
  .select("id,content,created_at", { count: "exact" })
  .order("created_at", { ascending: false })
  .limit(7));

await dump("app_settings", supabase
  .from("app_settings")
  .select("key,value,updated_at"));

await dump("push_subscriptions", supabase
  .from("push_subscriptions")
  .select("id,created_at", { count: "exact" })
  .order("created_at", { ascending: false })
  .limit(5));

await dump("insights", supabase
  .from("insights")
  .select("id,title,body,status,created_at,pushed_at", { count: "exact" })
  .order("created_at", { ascending: false })
  .limit(8));
