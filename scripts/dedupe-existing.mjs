// One-off: collapse duplicates that were written before dedup existed.
//
//   set -a && source .env.local && set +a && node scripts/dedupe-existing.mjs
//
// Dry by default — pass --apply to actually write. Always read the dry output
// first: this deletes rows, and a memory wrongly merged is real information
// lost, not just an untidy table.
//
// Strategy is deliberately conservative. It only ever proposes merging rows the
// classifier calls an outright duplicate; anything it calls an update or a
// conflict is REPORTED and left alone, because choosing which of two
// contradicting facts is true is not a decision a script should make.

import supabase from "../lib/supabase.js";
import { checkAgainst } from "../lib/dedupe.js";


const APPLY = process.argv.includes("--apply");

const TABLES = [
  { table: "memories", kind: "memory" },
  { table: "notes", kind: "note" },
  { table: "intentions", kind: "intention" }
];


async function sweep({ table, kind }) {

  const { data: rows, error } = await supabase
    .from(table)
    .select("id, content, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`${table}: ${error.message}`);
    return;
  }

  console.log(`\n=== ${table} (${rows.length}) ===`);

  // Walk oldest-first, keeping the survivors. Each row is checked against what
  // has been kept so far, so the OLDEST phrasing wins — it's the one other
  // rows may already reference, and stability beats freshness here.
  const kept = [];

  const removals = [];
  const flags = [];

  for (const row of rows) {

    if (kept.length === 0) { kept.push(row); continue; }

    // Against survivors only. checkDuplicate() reads the live table, which
    // still contains this row — it would match itself and every genuine
    // duplicate would be reported as new.
    const check = await checkAgainst({ content: row.content, candidates: kept, kind });

    if (check.verdict === "duplicate") {
      removals.push({ row, match: check.match, reason: check.reason });
      continue;
    }

    if (check.verdict === "update" || check.verdict === "conflict") {
      flags.push({ row, match: check.match, verdict: check.verdict, reason: check.reason });
    }

    kept.push(row);

  }


  for (const r of removals) {
    console.log(`  DELETE  "${r.row.content.slice(0, 72)}"`);
    console.log(`     dupe of "${r.match.content.slice(0, 72)}"  (${r.reason})`);
  }

  for (const f of flags) {
    console.log(`  ${f.verdict.toUpperCase()} — left alone, decide yourself:`);
    console.log(`     new: "${f.row.content.slice(0, 72)}"`);
    console.log(`     old: "${f.match.content.slice(0, 72)}"  (${f.reason})`);
  }

  if (removals.length === 0 && flags.length === 0) {
    console.log("  nothing to do");
    return;
  }

  if (!APPLY) return;

  for (const r of removals) {
    const { error: delError } = await supabase.from(table).delete().eq("id", r.row.id);
    if (delError) console.error(`     delete failed: ${delError.message}`);
  }

  console.log(`  removed ${removals.length}`);

}



for (const t of TABLES) await sweep(t);

console.log(
  APPLY
    ? "\nApplied."
    : "\nDry run — nothing was changed. Re-run with --apply to delete the rows marked DELETE."
);
