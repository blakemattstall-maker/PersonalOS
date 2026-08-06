import supabase from "./supabase.js";


// Which migrations are actually live on this database.
//
// Supabase's REST layer cannot run DDL, so every schema change in this project
// is a .sql file that a human pastes into the dashboard by hand. That means the
// database's real shape is tracked in prose, in a handoff document, and the
// code has no way to know what it's running against.
//
// The answer so far has been per-feature graceful degradation — tools/memory.js
// catches a missing embedding column, lib/settings.js catches a missing
// app_settings table — and it works, in the narrow sense that nothing crashes.
// The cost is that the system reports health it does not have: retrieval-based
// memory has been "shipped" while silently running the old blanket top-N
// fallback, because the migration was never run and nothing said so.
//
// This module makes that visible. It does not fix drift and it does not gate
// anything — it just answers, out loud, "which of these five files has actually
// been run", so the answer stops living in someone's memory.
//
// It probes for real objects rather than reading a ledger table, deliberately:
// a ledger would itself need a migration, and would then be able to disagree
// with reality. Probing cannot.


// Each entry names the file to run and the objects that prove it ran.
// `columns` are [table, column] pairs; a missing column reports the same way a
// missing table does.
const MIGRATIONS = [

  {
    file: "docs/schema-additions.sql",
    purpose: "proactive mode — push delivery, location, daily metrics, prompts",
    tables: ["push_subscriptions", "places", "location_points", "daily_metrics", "prompts"],
    breaksWithout: "Web push, location ingest, the daily metrics rollup and every app-initiated prompt."
  },

  {
    file: "docs/schema-settings.sql",
    purpose: "the interruption dial",
    tables: ["app_settings"],
    breaksWithout:
      "The interruption level cannot persist. Everything still works and behaves as " +
      "'digest + urgent', but changing the dial in /settings does not stick."
  },

  {
    file: "docs/schema-memory-retrieval.sql",
    purpose: "retrieval-based memory (S6)",
    columns: [["memories", "embedding"]],

    // PostgREST resolves a function by name AND argument names, so probing
    // with no arguments reports "could not find the function ... without
    // parameters" even when it exists — a false negative that made this very
    // check report a fully-applied migration as missing. Probe with the real
    // signature and a null vector: nothing is read, nothing is written.
    functions: [{ name: "match_memories", args: { query_embedding: null, match_count: 1 } }],
    breaksWithout:
      "Memory retrieval silently falls back to a blanket top-N-by-importance dump. " +
      "Nothing errors, but the main control on prompt size and cost is OFF — this is " +
      "the budget control, not an optimisation.",

    // A migration can be fully applied and still completely inert. This one
    // was: the column and function both existed, but no memory had ever been
    // embedded, so match_memories() (which filters `where embedding is not
    // null`) returned zero rows on every call. Retrieval then fell through to
    // blending in only the `alwaysTop` highest-importance memories — quietly
    // handing every reasoning call FOUR memories instead of twelve, with no
    // error anywhere. Schema presence is not the same as schema readiness.
    readiness: async () => {

      const { data, error } = await supabase.from("memories").select("id, embedding");

      if (error) return null;

      const total = (data || []).length;
      const embedded = (data || []).filter(row => row.embedding).length;

      if (total === 0) return null;

      if (embedded === 0) {
        return {
          ok: false,
          detail:
            `Applied, but 0 of ${total} memories are embedded — retrieval returns nothing and ` +
            "every reasoning call silently gets only the top few memories by importance. " +
            "Run backfillMemoryEmbeddings() from tools/memory.js once."
        };
      }

      if (embedded < total) {
        return {
          ok: false,
          detail: `${total - embedded} of ${total} memories are not embedded and are invisible to retrieval.`
        };
      }

      return { ok: true, detail: `All ${total} memories embedded.` };

    }
  },

  {
    file: "docs/schema-practice.sql",
    purpose: "the Practice tab — news framing and debate/pitch sessions",
    tables: ["news_items", "practice_sessions"],
    breaksWithout: "The Practice tab and the news sync cron."
  },

  {
    file: "docs/schema-people.sql",
    purpose: "relationship management",
    tables: ["people"],
    columns: [["calendar_events", "person_id"]],
    breaksWithout: "Saving people, relationship check-in nudges, and linking events to a person."
  },

  {
    file: "docs/schema-practice-split.sql",
    purpose: "evergreen debate topics, the standalone news feed, explainer pitches",
    tables: ["debate_topics"],
    columns: [
      ["news_items", "viewpoints"],
      ["news_items", "relevance_score"],
      ["practice_sessions", "debate_topic_id"],
      ["practice_sessions", "mode"]
    ],
    breaksWithout: "Debate has no topics to argue (the deck is empty), the news feed loses per-story viewpoints and personalised ordering, and explainer pitches are graded on the pitch rubric instead of their own."
  }

];


function missing(error) {

  if (!error) return false;

  // PGRST205 — unknown table, raised by PostgREST's schema cache.
  // PGRST204/PGRST202 — unknown column / unknown function, same source.
  // 42P01/42703/42883 — Postgres's own undefined table/column/function codes.
  return ["PGRST205", "PGRST204", "PGRST202", "42P01", "42703", "42883"].includes(error.code)
    || /schema cache/i.test(error.message || "")
    || /could not find/i.test(error.message || "")
    || /does not exist/i.test(error.message || "");

}


async function tableExists(table) {

  const { error } = await supabase.from(table).select("*", { count: "exact", head: true });

  return missing(error) ? false : true;

}


async function columnExists(table, column) {

  const { error } = await supabase.from(table).select(column).limit(1);

  return missing(error) ? false : true;

}


async function functionExists(name, args = {}) {

  const { error } = await supabase.rpc(name, args);

  if (!error) return true;

  // PostgREST matches on the argument NAMES, not just the function name, so
  // "without parameters" / "with parameters x, y" means the name resolved but
  // the signature didn't — i.e. the function is there. Only a bare
  // "could not find the function" means it genuinely isn't.
  if (/with(out)? parameter/i.test(error.message || "")) return true;

  if (/could not find the function/i.test(error.message || "")) return false;

  // Anything else — wrong types, a null vector, a constraint — means it ran.
  return true;

}


export async function checkMigrations() {

  const results = await Promise.all(MIGRATIONS.map(async migration => {

    const checks = [];

    for (const table of migration.tables || []) {
      checks.push(tableExists(table).then(ok => ({ object: table, kind: "table", ok })));
    }

    for (const [table, column] of migration.columns || []) {
      checks.push(columnExists(table, column).then(ok => ({ object: `${table}.${column}`, kind: "column", ok })));
    }

    for (const fn of migration.functions || []) {
      const { name, args } = typeof fn === "string" ? { name: fn, args: {} } : fn;
      checks.push(functionExists(name, args).then(ok => ({ object: `${name}()`, kind: "function", ok })));
    }

    const objects = await Promise.all(checks).catch(() => []);

    const absent = objects.filter(o => !o.ok).map(o => o.object);

    const applied = objects.length > 0 && absent.length === 0;

    // Only meaningful once the objects exist — a readiness probe against a
    // missing table would just repeat what `absent` already said.
    const readiness = applied && migration.readiness
      ? await migration.readiness().catch(() => null)
      : null;

    return {
      file: migration.file,
      purpose: migration.purpose,
      applied,
      partial: absent.length > 0 && absent.length < objects.length,
      missingObjects: absent,
      breaksWithout: migration.breaksWithout,
      readiness
    };

  }));


  const pending = results.filter(r => !r.applied);

  // Applied but inert — the failure mode that looks healthiest and isn't.
  const notReady = results.filter(r => r.applied && r.readiness && r.readiness.ok === false);


  return {

    applied: results.filter(r => r.applied).map(r => r.file),

    pending,

    notReady,

    // The one line worth putting on a dashboard.
    verdict: pending.length > 0
      ? `${pending.length} migration${pending.length === 1 ? "" : "s"} not applied — ` +
        `${pending.map(p => p.file.replace("docs/", "")).join(", ")}. ` +
        "Paste each into the Supabase SQL editor. Features degrade silently until you do."
      : notReady.length > 0
        ? `All migrations applied, but ${notReady.length} is not doing anything yet: ` +
          notReady.map(r => r.readiness.detail).join(" ")
        : "All migrations applied and active.",

    migrations: results

  };

}
