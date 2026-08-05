import supabase from "../lib/supabase.js";
import { DateTime } from "luxon";
import { getFinancialData } from "../lib/simplefin.js";
import { getEvents } from "./googleCalendar.js";
import { getUserTimezone } from "../lib/profile.js";
import { taskDueDate } from "./googleTasks.js";


// One row per day, across every domain.
//
// This is the only thing that makes "when you spend less time at the gym you
// spend more that week" answerable. Live reads can tell you what is true now;
// they cannot tell you what was true in March, and correlation needs both
// series at the same grain. Nothing else in the system stores history at a
// comparable resolution, so without this every cross-domain claim would be
// guesswork dressed up as analysis.
//
// Nulls are meaningful: they mean "not measured that day", not zero. A day with
// no location data must not read as a day spent nowhere.
//
// Recomputes a trailing window on every run rather than only yesterday, so a
// missed cron or a late-posting transaction heals itself.

const DEFAULT_WINDOW_DAYS = 7;


export async function rollupDailyMetrics({ days = DEFAULT_WINDOW_DAYS } = {}) {

  const tz = await getUserTimezone();

  const today = DateTime.now().setZone(tz).startOf("day");

  // Pull each source once for the whole window instead of per day.
  const [finance, completions, tasks, events, weights, points] = await Promise.all([

    getFinancialData({ days: days + 2 }).catch(() => ({ accounts: [] })),

    supabase.from("activity_logs")
      .select("output, created_at")
      .eq("action", "task_completed")
      .gte("created_at", today.minus({ days }).toISO()),

    supabase.from("tasks").select("status, due_date"),

    getEvents({
      startDate: today.minus({ days }).toFormat("yyyy-MM-dd"),
      endDate: today.toFormat("yyyy-MM-dd"),
      timezone: tz,
      maxResults: 250
    }).catch(() => ({ events: [] })),

    supabase.from("bodyweight_logs")
      .select("weight, logged_at")
      .gte("logged_at", today.minus({ days }).toISO()),

    supabase.from("location_points")
      .select("recorded_at, place_id")
      .gte("recorded_at", today.minus({ days }).toISO())

  ]);


  const transactions = (finance.accounts || []).flatMap(a => a.transactions);

  const rows = [];


  for (let i = days; i >= 1; i--) {

    const day = today.minus({ days: i });
    const key = day.toFormat("yyyy-MM-dd");

    const onDay = arr => arr.filter(Boolean);

    const dayTx = transactions.filter(
      t => DateTime.fromJSDate(t.date).setZone(tz).toFormat("yyyy-MM-dd") === key
    );

    const spend = dayTx.filter(t => t.amount < 0);
    const income = dayTx.filter(t => t.amount > 0);

    const dayCompletions = onDay(completions.data || []).filter(
      c => DateTime.fromISO(c.output?.completed_at || c.created_at).setZone(tz).toFormat("yyyy-MM-dd") === key
    );

    const dayEvents = onDay(events.events || []).filter(
      e => e.start && !e.allDay &&
        DateTime.fromISO(e.start).setZone(tz).toFormat("yyyy-MM-dd") === key
    );

    const busyMinutes = dayEvents.reduce((sum, e) => {
      const s = DateTime.fromISO(e.start);
      const en = DateTime.fromISO(e.end);
      const m = en.diff(s, "minutes").minutes;
      return sum + (Number.isFinite(m) && m > 0 ? m : 0);
    }, 0);

    const dayWeights = onDay(weights.data || []).filter(
      w => DateTime.fromISO(w.logged_at).setZone(tz).toFormat("yyyy-MM-dd") === key
    );

    const dayPoints = onDay(points.data || []).filter(
      p => DateTime.fromISO(p.recorded_at).setZone(tz).toFormat("yyyy-MM-dd") === key
    );

    const hadLocation = dayPoints.length > 0;

    // Overdue is a snapshot of now, not of that day — the historical value
    // can't be reconstructed, so only today's row gets it.
    const overdueNow = (tasks.data || []).filter(
      t => t.status !== "completed" && t.due_date &&
        DateTime.fromISO(t.due_date).setZone(tz).toFormat("yyyy-MM-dd") < today.toFormat("yyyy-MM-dd")
    ).length;


    rows.push({
      day: key,
      spend_total: dayTx.length ? Number(spend.reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2)) : null,
      income_total: dayTx.length ? Number(income.reduce((s, t) => s + t.amount, 0).toFixed(2)) : null,
      transaction_count: dayTx.length || null,
      tasks_completed: dayCompletions.length,
      tasks_completed_late: dayCompletions.filter(c => (c.output?.days_late ?? 0) > 0).length,
      tasks_overdue: i === 1 ? overdueNow : null,
      calendar_busy_minutes: Math.round(busyMinutes),
      weight: dayWeights.length ? Number(dayWeights[0].weight) : null,
      places_visited: hadLocation ? new Set(dayPoints.map(p => p.place_id).filter(Boolean)).size : null,
      minutes_at_gym: null,
      computed_at: new Date().toISOString()
    });

  }


  const { error } = await supabase
    .from("daily_metrics")
    .upsert(rows, { onConflict: "day" });

  if (error) throw new Error(error.message);


  return {
    success: true,
    message: `Rolled up ${rows.length} day(s) of metrics.`,
    data: { days: rows.length, latest: rows[rows.length - 1] }
  };

}


export async function getRecentMetrics({ days = 30 } = {}) {

  const { data, error } = await supabase
    .from("daily_metrics")
    .select("*")
    .order("day", { ascending: false })
    .limit(days);

  if (error) throw new Error(error.message);

  return data || [];

}
