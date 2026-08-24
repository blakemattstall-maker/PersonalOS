import supabase from "./supabase.js";
import { probeTable } from "./tableProbe.js";


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
    file: "docs/schema-triggers.sql",
    purpose: "standing reminders the app runs itself — arriving somewhere, before a matching calendar event, at a time of day",
    tables: ["triggers", "trigger_fires", "trigger_logs"],
    columns: [["places", "arrived_at"]],
    breaksWithout: "Nothing fires on its own and nothing can be logged against a reminder. Captures still answer and still save memories and projects; they simply cannot set a reminder up."
  },

  {
    file: "docs/schema-jobs-pipeline.sql",
    purpose: "application outcomes — the events a pipeline chart is built from",
    tables: ["job_events"],
    columns: [["job_postings", "stage"]],
    breaksWithout: "The Pipeline page and every stage button; the feed and alerts are unaffected."
  },

  {
    file: "docs/schema-jobs-track.sql",
    purpose: "internship deadlines and follow-ups",
    columns: [["job_postings", "deadline"], ["job_postings", "applied_at"], ["job_postings", "last_nudged_at"]],
    breaksWithout: "Nothing warns that an application closes tomorrow, and a submitted application that goes quiet is never surfaced again."
  },

  {
    file: "docs/schema-jobs-detail.sql",
    purpose: "internship filtering — term, graduation-year fit, pay, discipline",
    columns: [["job_postings", "term"], ["job_postings", "grad_fit"], ["job_postings", "pay_min"]],
    breaksWithout: "The Jobs tab cannot narrow to Summer 2027, rule out postings that require a graduation year he does not have, or sort by pay."
  },

  {
    file: "docs/schema-jobs.sql",
    purpose: "the internship monitor — company watchlist and everything ever posted",
    tables: ["job_sources", "job_postings"],
    breaksWithout: "The Jobs half of the Career tab, and every new-posting alert."
  },

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
  },

  {
    file: "docs/schema-accountability.sql",
    purpose: "recurring reminders, event colour, calendar recurrence",
    columns: [
      ["tasks", "recurrence_key"],
      ["tasks", "person_id"],
      ["calendar_events", "color_id"],
      ["calendar_events", "recurrence"]
    ],
    breaksWithout: "Birthday/anniversary reminders can't be created as recurring tasks (they're silently skipped rather than duplicated), and events lose colour-coding and recurrence."
  },

  {
    file: "docs/schema-finance-cache.sql",
    purpose: "cache SimpleFIN responses instead of a live call per request",
    tables: ["finance_cache"],
    breaksWithout: "Every financial query — and every reasoning call that pulls in signals, which is most of them — hits SimpleFIN live instead of a 12-hour cache. Not broken, just slower and needlessly frequent."
  },

  // These last two were missing from this list entirely, which meant the check
  // built to catch silent drift reported "All migrations applied and active"
  // without ever having looked at the graph — the newest layer in the system
  // and the one with the least operational history. Both happened to be
  // applied. That was luck, not verification, and the guard has to cover the
  // thing it was written to protect. tests/schema-coverage.test.js now fails if
  // a docs/schema-*.sql file has no entry here.
  {
    file: "docs/schema-islands.sql",
    purpose: "the entity graph — edges, stored transactions, and detected insights",
    tables: ["entity_links", "transactions", "insights"],
    breaksWithout:
      "The whole cross-domain layer. No edges are written, so no finding that " +
      "depends on connecting two domains can be detected, and recentInsights() " +
      "returns nothing to every reasoning call. Everything degrades to per-table " +
      "answers with no error anywhere.",

    // Applied but inert is the real risk here, same as memory retrieval. The
    // tables can exist and hold nothing because the nightly job has never run
    // or has been failing quietly — and an empty graph is indistinguishable
    // from a system that has not noticed anything yet.
    readiness: async () => {

      const [links, txns] = await Promise.all([
        probeTable("entity_links"),
        probeTable("transactions")
      ]);

      if (links.error || txns.error) return null;

      if ((links.count ?? 0) === 0) {
        return {
          ok: false,
          detail:
            "Applied, but entity_links is empty — no connection between domains has " +
            "ever been recorded, so every graph-derived insight is unreachable. Run " +
            "the connectIslands cron (rebuildLinks) once and check it succeeds."
        };
      }

      if ((txns.count ?? 0) === 0) {
        return {
          ok: false,
          detail:
            `${links.count} edge(s), but no transactions are stored — money cannot be ` +
            "linked to a project, person or place, so project_cost and contradiction " +
            "findings can never fire. Check syncTransactions in the connectIslands cron."
        };
      }

      return { ok: true, detail: `${links.count} edge(s) across ${txns.count} stored transaction(s).` };

    }
  },

  {
    file: "docs/schema-merchants.sql",
    purpose: "merchants and spending categories as entities, so money joins the graph",
    tables: ["merchants", "spend_categories"],
    breaksWithout:
      "The entity roster stays at twelve names, so 119 of 129 transactions have " +
      "nothing to attach to and one project keeps holding most of the graph. " +
      "Nothing errors — rebuildLinks skips the promotion and carries on — but the " +
      "graph page has almost nothing to show and no note can ever link to a shop.",

    // Applied-but-inert again, and here it is the likeliest outcome by far: the
    // tables are created empty and stay empty until the nightly cron runs. A
    // graph page reading an empty merchants table looks identical to a person
    // who has never bought anything.
    readiness: async () => {

      const [merchants, categories] = await Promise.all([
        probeTable("merchants"),
        probeTable("spend_categories")
      ]);

      if (merchants.error || categories.error) return null;

      if ((merchants.count ?? 0) === 0) {
        return {
          ok: false,
          detail:
            "Applied, but no merchants have been derived yet — run the connectIslands " +
            "cron once. Until then money contributes almost nothing to the graph."
        };
      }

      return {
        ok: true,
        detail: `${merchants.count} merchant(s) and ${categories.count} spending categor(ies) in the roster.`
      };

    }
  },

  {
    file: "docs/schema-nudge-scheduling.sql",
    purpose: "generating a nudge and delivering it are two different moments",
    columns: [["nudges", "deliver_at"], ["nudges", "pushed_at"]],
    breaksWithout:
      "Nudges are pushed the instant they are generated rather than when they are " +
      "actionable, so everything the app has to say arrives in one morning clump — " +
      "which is the pile-up the delivery windows exist to prevent. createNudge falls " +
      "back to the immediate insert, so nothing errors."
  },

  {
    file: "docs/schema-waitlist.sql",
    purpose: "public waitlist signups from /welcome",
    tables: ["waitlist"],
    breaksWithout:
      "The waitlist form on the welcome tour degrades to a friendly 'try again' — the " +
      "insert fails because the table isn't there, so no email is captured, but the " +
      "page never errors."
  },

  {
    file: "docs/schema-dining.sql",
    purpose: "dining hall menus — two weeks of meals per station, with nutrition labels",
    tables: ["dining_menus", "dining_recipes"],
    breaksWithout:
      "The /food page and the nightly dining sync. Both say so plainly — the page " +
      "shows the migration hint and the sync logs it — but no menu can be stored " +
      "until this runs.",

    // Applied-but-inert is the certain first state here: the tables are created
    // empty and stay empty until a sync runs (the nightly cron, or the Sync
    // button on /food doing the first big fill).
    readiness: async () => {

      const menus = await probeTable("dining_menus");

      if (menus.error) return null;

      if ((menus.count ?? 0) === 0) {
        return {
          ok: false,
          detail:
            "Applied, but dining_menus is empty — no sync has completed. Tap Sync on " +
            "/food (it continues where it left off; the first fill takes a few passes) " +
            "or wait for the nightly cron."
        };
      }

      return { ok: true, detail: `${menus.count} station-meal menu(s) stored.` };

    }
  },

  {
    file: "docs/schema-dining-log.sql",
    purpose: "meal plans and calorie tracking on top of the dining menus",
    tables: ["dining_log"],
    columns: [
      ["daily_metrics", "calories_eaten"],
      ["daily_metrics", "protein_eaten"]
    ],
    breaksWithout:
      "The Plan tab on /food, the Track buttons, and the plan_meals / log_meal " +
      "capture tools — each says so plainly. The menu browser keeps working; " +
      "the daily rollup simply never learns nutrition."
  }

];


// Exported for the coverage test only, which asserts that every
// docs/schema-*.sql file appears here. Named so a call site that wanted the
// live answer reaches for checkMigrations() instead.
export const MIGRATIONS_FOR_TEST = MIGRATIONS;


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


// The same probe lib/diagnostics.js counts rows with. It runs this check inside
// the same Promise.all, so sharing it turns two identical concurrent round trips
// per table into one — see lib/tableProbe.js.
async function tableExists(table) {

  const { error } = await probeTable(table);

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
        ? `All migrations applied, but ${notReady.length} ${notReady.length === 1 ? "is" : "are"} not doing anything yet: ` +
          notReady.map(r => r.readiness.detail).join(" ")
        : "All migrations applied and active.",

    migrations: results

  };

}
