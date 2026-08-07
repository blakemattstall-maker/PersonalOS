import supabase from "./supabase.js";
import { getSettings } from "./settings.js";
import { checkMigrations } from "./schema.js";


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


async function countOf(table) {

  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  return error ? null : (count ?? 0);

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


export async function buildDiagnostics() {

  const [counts, lastPoint, lastBrief, lastMetric, lastLog, lastIngest, pushSubs, settings, schema] =
    await Promise.all([

      Promise.all(TABLES.map(async t => [t, await countOf(t)])).then(Object.fromEntries),

      latest("location_points", "recorded_at"),
      latest("briefs", "created_at"),
      latest("daily_metrics", "computed_at"),
      latest("activity_logs", "created_at"),

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
      })

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
    anyActivity: { lastAt: lastLog, ageHours: ageHours(lastLog) }
  };


  return {
    success: true,
    checkedAt: new Date().toISOString(),
    location,
    push,
    jobs,
    schema,
    counts,
    settings: { interruption_level: settings.interruption_level, persisted: settings.persisted !== false }
  };

}
