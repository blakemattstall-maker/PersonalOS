// Read-only: did the last push actually go out to devices?
//
//   node --env-file=.env.local dev/check-push-delivery.mjs

import supabase from "../web/lib/supabase.js";

const { data } = await supabase
  .from("push_subscriptions")
  .select("id, created_at, last_used_at")
  .order("created_at", { ascending: false });

for (const row of data || []) {
  console.log(JSON.stringify(row));
}

const { data: nudge } = await supabase
  .from("nudges")
  .select("id, message, status, created_at, deliver_at, pushed_at")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

console.log("latest nudge:", JSON.stringify(nudge));
