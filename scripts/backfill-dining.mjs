// One-off: the first big dining fill, run from a laptop instead of eating
// cron slices for a week.
//
//   set -a && source .env.local && set +a && node scripts/backfill-dining.mjs
//
// Needs NETNUTRITION_URL and NETNUTRITION_UNIT_OID in .env.local alongside the
// Supabase keys, and the tables from docs/schema-dining.sql already created.
//
// It is the exact same sync the cron runs — syncDiningMenus with a bigger
// budget, called until nothing remains — so anything this does, the nightly
// job and the Sync button on /food do identically. Safe to re-run anytime;
// the sync is a diff, so a second pass over a full table does nothing.

import { syncDiningMenus } from "../web/tools/dining.js";


let pass = 0;

while (true) {

  pass += 1;

  const result = await syncDiningMenus({ budgetMs: 120_000 });

  console.log(
    `pass ${pass}: synced ${result.synced} menus (${result.labels} new labels), ` +
    `${result.remaining} remaining, ${result.pruned} pruned` +
    (result.errors.length ? `, errors: ${result.errors.join(" | ")}` : "")
  );

  if (result.errors.length && result.synced === 0) {
    console.error("No progress and errors present — stopping.");
    process.exit(1);
  }

  if (result.remaining <= 0) {
    console.log("Done — every listed menu is stored.");
    break;
  }

}
