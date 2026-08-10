import supabase from "../lib/supabase.js";
import { DateTime } from "luxon";
import { loadMoney } from "../lib/money.js";
import { getEvents } from "./googleCalendar.js";
import { getUserTimezone } from "../lib/profile.js";
import { taskDueDate } from "./googleTasks.js";
import { visitsInWindow, looksLikeGym } from "./location.js";


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
// missed cron or a late-posting transaction heals itself. That self-healing is
// what made the spend_total fix below cheap: this table counted every negative
// row as spending, including Zelle transfers, so it was accumulating history
// against a definition no other part of the app used — and history written
// wrongly cannot be compared against history written correctly. Because the
// window recomputes, the last seven days repair themselves on the next run;
// anything older is why this was worth fixing before the correlation work
// rather than after it.

const DEFAULT_WINDOW_DAYS = 7;


export async function rollupDailyMetrics({ days = DEFAULT_WINDOW_DAYS } = {}) {

  const tz = await getUserTimezone();

  const today = DateTime.now().setZone(tz).startOf("day");

  // Pull each source once for the whole window instead of per day.
  //
  // Every source that can fail is tracked, because this table's cardinal rule
  // is that null means "not measured" and 0 means "measured, and it was zero".
  // A calendar fetch that throws must write null busy-minutes, not 0 — writing
  // 0 tells the trend engine downstream that a day with three meetings was
  // empty, and history written wrongly cannot be compared against history
  // written right. The old code caught these into empty arrays with no log and
  // no flag, so an outage silently rewrote a week of the longitudinal record as
  // false zeros. Now each failure is loud and lands as null.
  const [finance, completions, tasks, events, weights, points] = await Promise.all([

    loadMoney({ days: days + 2 }).catch(error => {
      console.error("METRICS money source FAILED — spend/income written null:", error.message);
      return { transactions: [], failed: true };
    }),

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
    }).catch(error => {
      console.error("METRICS calendar source FAILED — busy-minutes written null:", error.message);
      return { events: [], failed: true };
    }),

    supabase.from("bodyweight_logs")
      .select("weight, logged_at")
      .gte("logged_at", today.minus({ days }).toISO()),

    supabase.from("location_points")
      .select("recorded_at, place_id")
      .gte("recorded_at", today.minus({ days }).toISO())

  ]);


  // A failed source must write null for its columns, never a fabricated zero.
  // The raw Supabase reads carry their error in .error; the two async sources
  // above carry a `failed` flag. Logged by name so a source dead for a week is
  // visible, not mistaken for a genuinely quiet week.
  const moneyFailed = finance.failed === true;
  const calendarFailed = events.failed === true;

  if (completions.error) console.error("METRICS completions source FAILED — tasks_completed written null:", completions.error.message);
  if (tasks.error) console.error("METRICS tasks source FAILED — overdue written null:", tasks.error.message);
  if (weights.error) console.error("METRICS bodyweight source FAILED — weight written null:", weights.error.message);
  if (points.error) console.error("METRICS location source FAILED — places/gym written null:", points.error.message);

  const completionsFailed = Boolean(completions.error);
  const tasksFailed = Boolean(tasks.error);
  const weightsFailed = Boolean(weights.error);
  const pointsFailed = Boolean(points.error);


  // Visits, not points. `minutes_at_gym` has been hardcoded null since this
  // table was created — the column existed as a statement of intent with
  // nothing behind it. A visit's duration is arithmetic over two timestamps,
  // so this is a computed fact rather than an inference, and it only fires for
  // a place the user themselves labelled as a gym (see looksLikeGym).
  const visits = await visitsInWindow({ days, tz }).catch(error => {
    console.error("VISIT ROLLUP FAILED:", error.message);
    return [];
  });


  // Already categorised, so `transfers` can be told apart from spending. Moving
  // money between your own accounts is not a purchase, and the day a $1,385
  // Zelle went out was being recorded as the biggest spending day on file.
  const transactions = (finance.transactions || []).filter(t => t.category !== "transfers");

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

    const dayVisits = visits.filter(v => v.day === key);

    const gymMinutes = dayVisits
      .filter(v => looksLikeGym(v))
      .reduce((total, v) => total + v.minutes, 0);

    // Overdue is a snapshot of now, not of that day — the historical value
    // can't be reconstructed, so only today's row gets it.
    const overdueNow = (tasks.data || []).filter(
      t => t.status !== "completed" && t.due_date &&
        DateTime.fromISO(t.due_date).setZone(tz).toFormat("yyyy-MM-dd") < today.toFormat("yyyy-MM-dd")
    ).length;


    rows.push({
      day: key,
      // A failed money fetch leaves dayTx empty, which already lands as null —
      // but guard on the flag too, so a future refactor can't turn the failure
      // back into a real-looking zero.
      spend_total: moneyFailed || !dayTx.length ? null : Number(spend.reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2)),
      income_total: moneyFailed || !dayTx.length ? null : Number(income.reduce((s, t) => s + t.amount, 0).toFixed(2)),
      transaction_count: moneyFailed ? null : (dayTx.length || null),
      // null, not 0, when the completions query failed — "measured zero done"
      // and "couldn't measure" are different facts the trend engine must not
      // confuse.
      tasks_completed: completionsFailed ? null : dayCompletions.length,
      tasks_completed_late: completionsFailed ? null : dayCompletions.filter(c => (c.output?.days_late ?? 0) > 0).length,
      tasks_overdue: tasksFailed ? null : (i === 1 ? overdueNow : null),
      // null when the calendar fetch threw — 0 would assert an empty day the
      // system never actually saw.
      calendar_busy_minutes: calendarFailed ? null : Math.round(busyMinutes),
      weight: weightsFailed || !dayWeights.length ? null : Number(dayWeights[0].weight),
      places_visited: pointsFailed || !hadLocation ? null : new Set(dayPoints.map(p => p.place_id).filter(Boolean)).size,
      // Null when there was no location data at all, and null when no place
      // the user has labelled as a gym was visited — the second is "didn't
      // go", which is a real zero, but only once there is location for that
      // day to prove it. A day with no data must not read as a day at home.
      minutes_at_gym: pointsFailed || !hadLocation ? null : gymMinutes,
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
