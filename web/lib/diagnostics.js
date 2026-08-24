import supabase from "./supabase.js";
import { getSettings } from "./settings.js";
import { checkMigrations } from "./schema.js";
import { probeTable } from "./tableProbe.js";
import { getGoogleClient, SCOPES } from "./google.js";


// A single honest answer to "is this thing actually running".
//
// Built because Overland silently delivered nothing for a day and the only way
// to find out was to query Supabase by hand. Anything that depends on a device
// outside this codebase — the phone sending GPS, the phone accepting push,
// Vercel firing crons — needs a place that says plainly when it last worked,
// because "no data" and "broken" look identical from the dashboard otherwise.

const TABLES = [
  "memories", "intentions", "notes", "tasks", "calendar_events", "projects",
  "deep_thoughts", "briefs", "prompts", "nudges", "activity_logs",
  "location_points", "places", "daily_metrics", "push_subscriptions"
];


// Shared with lib/schema.js, which asks the identical question about many of the
// same tables at the same moment — see lib/tableProbe.js.
async function countOf(table) {

  const { count, error } = await probeTable(table);

  return error ? null : count;

}


async function latest(table, column) {

  const { data, error } = await supabase
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  return data[0][column];

}


function ageHours(iso) {
  if (!iso) return null;
  return Math.round(((Date.now() - new Date(iso).getTime()) / 3600000) * 10) / 10;
}


// A live probe, not a row check. The google_integrations row existing says
// nothing — the row was sitting right there the morning every Google call in
// the system started failing, because what dies is the token inside it.
// getGoogleClient() proves the token against Google's own token endpoint (and
// is the same choke point every tool goes through, so this page and the
// failures can never disagree). Exactly the calendar/tasks/inbox outage this
// panel exists for: "no data" and "broken" must not look identical.
//
// The scope comparison catches the quieter failure: a consent screen where one
// box was unticked leaves a working token that 403s on a single feature weeks
// later. The refresh response says what the token actually carries; older
// grants that don't echo a scope list are left unjudged rather than accused.
async function googleConnection() {

  const short = (s) => s.replace("https://www.googleapis.com/auth/", "");

  try {

    const { auth } = await getGoogleClient();

    const granted = String(auth.credentials?.scope || "").split(" ").filter(Boolean);
    const missing = granted.length ? SCOPES.filter(s => !granted.includes(s)).map(short) : [];

    return {
      connected: true,
      expired: false,
      missingScopes: missing,
      verdict: missing.length
        ? `connected, but ${missing.length} permission${missing.length === 1 ? " was" : "s were"} declined at the last consent: ${missing.join(", ")}. Those features will fail until you reconnect and approve everything.`
        : "connected — the stored token refreshed successfully just now"
    };

  } catch (error) {

    const expired = error?.code === "GOOGLE_AUTH_EXPIRED";

    return {
      connected: false,
      expired,
      missingScopes: [],
      verdict: expired
        ? "expired — Google revoked the stored token, so calendar, tasks, Gmail and Docs are all down until you reconnect"
        : `unreachable — ${error?.message || "unknown error"}`
    };

  }

}


export async function buildDiagnostics() {

  const [counts, lastPoint, lastBrief, lastMetric, lastLog, lastLink, lastNews, lastIngest, lastCanvas, lastDining, pushSubs, settings, schema, googleStatus] =
    await Promise.all([

      Promise.all(TABLES.map(async t => [t, await countOf(t)])).then(Object.fromEntries),

      latest("location_points", "recorded_at"),
      latest("briefs", "created_at"),
      latest("daily_metrics", "computed_at"),
      latest("activity_logs", "created_at"),
      // The nightly graph rebuild and the news sync have no other heartbeat. If
      // connectIslands starts failing, entity_links simply stops growing and the
      // graph freezes with no error anywhere — this is the surface that says so.
      latest("entity_links", "created_at"),
      latest("news_items", "surfaced_at"),

      // Every hit on the location endpoint is logged, successful or not, so
      // "Overland has never contacted us" is distinguishable from "Overland
      // contacted us and sent an empty batch" — completely different problems.
      supabase
        .from("activity_logs")
        .select("created_at, input, output, success")
        .eq("action", "location_ingest")
        .order("created_at", { ascending: false })
        .limit(5)
        .then(r => r.data || []),

      // The Canvas sync writes one of these per run (tools/canvas.js), errors
      // included — before this, a morning where every createTask failed left
      // the same trace as a morning with nothing new: none.
      supabase
        .from("activity_logs")
        .select("created_at, success, output")
        .eq("action", "canvas_sync")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(r => (r.data || [])[0] || null),

      // Same trace for the dining sync (tools/dining.js): it shares Canvas's
      // cron slot, and "no menus" must be tellable apart from "sync failing".
      supabase
        .from("activity_logs")
        .select("created_at, success, output")
        .eq("action", "dining_sync")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(r => (r.data || [])[0] || null),

      supabase
        .from("push_subscriptions")
        .select("user_agent, created_at, last_used_at")
        .order("created_at", { ascending: false })
        .then(r => r.data || []),

      getSettings(),

      // Which of the five docs/schema-*.sql files are actually live. Supabase
      // DDL is a manual paste, so the database's real shape has until now been
      // tracked only in a handoff document — and every feature that depends on
      // a pending migration degrades silently rather than failing. This is the
      // one place that says so out loud.
      checkMigrations().catch(error => {
        console.error("SCHEMA CHECK FAILED:", error.message);
        return { verdict: "Could not determine migration state.", pending: [], applied: [], migrations: [] };
      }),

      googleConnection()

    ]);


  const location = {
    points: counts.location_points,
    places: counts.places,
    lastPointAt: lastPoint,
    lastPointAgeHours: ageHours(lastPoint),
    lastDeliveryAttemptAt: lastIngest[0]?.created_at || null,
    deliveryAttempts: lastIngest.length,
    recentAttempts: lastIngest.map(a => ({
      at: a.created_at,
      ok: a.success,
      detail: a.output
    })),
    verdict:
      counts.location_points > 0
        ? (ageHours(lastPoint) != null && ageHours(lastPoint) < 6
            ? "delivering"
            : "stale — last point is older than 6 hours")
        : lastIngest.length > 0
          ? "Overland is reaching the endpoint but sending no usable points"
          : "Overland has never contacted this endpoint"
  };


  const push = {
    devices: pushSubs.length,
    subscriptions: pushSubs.map(s => ({
      device: (s.user_agent || "").slice(0, 60),
      registeredAt: s.created_at,
      lastUsedAt: s.last_used_at
    })),
    verdict: pushSubs.length > 0 ? "at least one device subscribed" : "no device subscribed"
  };


  const jobs = {
    morningBrief: { lastAt: lastBrief, ageHours: ageHours(lastBrief) },
    reviewIntentions: { lastAt: lastMetric, ageHours: ageHours(lastMetric) },
    // The graph rebuild and news sync — each was invisible here before, so a
    // frozen graph or a dead feed looked exactly like a quiet week.
    connectIslands: { lastAt: lastLink, ageHours: ageHours(lastLink) },
    syncNews: { lastAt: lastNews, ageHours: ageHours(lastNews) },
    syncCanvas: {
      lastAt: lastCanvas?.created_at || null,
      ageHours: ageHours(lastCanvas?.created_at),
      ok: lastCanvas ? lastCanvas.success !== false : null,
      detail: lastCanvas?.output || null
    },
    syncDining: {
      lastAt: lastDining?.created_at || null,
      ageHours: ageHours(lastDining?.created_at),
      ok: lastDining ? lastDining.success !== false : null,
      detail: lastDining?.output || null
    },
    anyActivity: { lastAt: lastLog, ageHours: ageHours(lastLog) }
  };


  // Standing reminders, and the two ways they die quietly: the clock half stops
  // being called, or every trigger is checked and none ever matches. Both look
  // exactly like "a quiet week" without a count next to a timestamp.
  const { data: activeTriggers } = await supabase
    .from("triggers").select("id, label, kind, last_fired_at, fire_count").eq("active", true)
    .then(r => r, () => ({ data: null }));

  // latest() takes no filter and returns a bare column value, so the sweep's
  // own row is read directly.
  const { data: sweeps } = await supabase
    .from("activity_logs")
    .select("created_at, success, output")
    .eq("action", "triggers_checked")
    .order("created_at", { ascending: false })
    .limit(1)
    .then(r => r, () => ({ data: null }));

  const lastSweep = sweeps?.[0] || null;

  const triggers = {
    active: activeTriggers?.length ?? null,
    // null rather than 0 when the table is missing, so "not set up yet" and
    // "set up and doing nothing" are not the same reading.
    neverFired: activeTriggers ? activeTriggers.filter(t => !t.last_fired_at).length : null,
    lastSweepAt: lastSweep?.created_at || null,
    lastSweepAgeHours: ageHours(lastSweep?.created_at),
    lastSweepOk: lastSweep ? lastSweep.success !== false : null,
    lastSweepDetail: lastSweep?.output || null,
    list: (activeTriggers || []).slice(0, 8).map(t => ({
      label: t.label,
      kind: t.kind,
      fired: t.fire_count,
      lastAt: t.last_fired_at
    }))
  };


  return {
    success: true,
    checkedAt: new Date().toISOString(),
    google: googleStatus,
    location,
    push,
    jobs,
    triggers,
    schema,
    counts,
    settings: { interruption_level: settings.interruption_level, persisted: settings.persisted !== false }
  };

}
