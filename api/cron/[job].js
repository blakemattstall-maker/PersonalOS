import { syncCanvasAssignments } from "../../tools/canvas.js";
import { querySchedule } from "../../tools/schedule.js";
import { queryTasks } from "../../tools/taskQuery.js";
import { createBrief } from "../../tools/database.js";
import { reviewIntentionsForNudges } from "../../tools/nudges.js";
import { checkProjectDeadlines } from "../../tools/projectCheckup.js";
import { regenerateBio } from "../../tools/profileEvolution.js";
import { syncTaskCompletions } from "../../tools/completions.js";
import { rollupDailyMetrics } from "../../tools/metrics.js";
import { runDailyObservation } from "../../tools/observer.js";
import { syncNewsDigest } from "../../tools/news.js";
import { ensureTopicsFramed } from "../../tools/debateTopics.js";
import { checkRelationshipCheckins, materialiseUpcomingDateReminders } from "../../tools/people.js";
import { getUserTimezone } from "../../lib/profile.js";
import { DateTime } from "luxon";


// All scheduled jobs behind one dynamic route.
//
// Vercel Hobby allows 12 serverless functions per deployment and the project
// sat at exactly 12, which blocked every planned integration — banking needs a
// link route and a webhook, location needs an ingest route. A dynamic segment
// counts as ONE function while still matching /api/cron/morningBrief,
// /api/cron/syncCanvas, /api/cron/reviewIntentions and now
// /api/cron/syncNews, so the schedules in vercel.json are untouched and the
// cron paths keep working exactly as before.


async function morningBrief() {

  const tz = await getUserTimezone();

  const today = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");


  const [schedule, tasks] = await Promise.all([
    querySchedule({ startDate: today, endDate: today, question: "What's on my schedule today?" }),
    queryTasks({ question: "What tasks do I have?" })
  ]);


  const content = `Schedule: ${schedule.message}\n\nTasks: ${tasks.message}`;

  const brief = await createBrief({ content });


  return { success: true, brief_id: brief.id, content };

}


async function syncCanvas() {

  return syncCanvasAssignments();

}


async function syncNews() {

  // Two jobs on one schedule, deliberately. The evergreen debate deck needs
  // topping up occasionally as seed topics get framed, but it does NOT deserve
  // its own cron entry: Vercel Hobby's timing is loose enough that every added
  // schedule is another thing that can drift, and the deck only needs to gain
  // a few topics a day to stay ahead of how fast anyone can argue through it.
  //
  // Topic framing is best-effort — a failure here must not cost the news sync,
  // which is the part with a real daily deadline.
  const [digest, topics] = await Promise.allSettled([
    syncNewsDigest(),
    ensureTopicsFramed({ limit: 6 })
  ]);

  return {
    news: digest.status === "fulfilled" ? digest.value : { success: false, error: digest.reason?.message },
    debateTopics: topics.status === "fulfilled" ? topics.value : { success: false, error: topics.reason?.message }
  };

}


async function reviewIntentions() {

  // Completion sync runs first and in the same job: the cascade check below
  // asks Google whether overdue tasks are done, so recording completions
  // beforehand keeps both looking at the same reality. Folded in here rather
  // than added as a fourth schedule — it needs no separate cadence, and it
  // lands before the 13:00 brief so the day's summary reflects it.
  const completionResult = await syncTaskCompletions();


  const [nudgeResult, projectResult, relationshipResult, dateReminderResult] = await Promise.all([
    reviewIntentionsForNudges(),
    checkProjectDeadlines(),
    checkRelationshipCheckins().catch(error => {
      console.error("RELATIONSHIP CHECK-IN REVIEW FAILED:", error.message);
      return { success: false, error: error.message };
    }),
    // This IS the recurrence engine for birthdays and anniversaries — Google's
    // Tasks API has no recurrence field, so each year's reminder is created
    // here as the date comes back into range. Idempotent via a unique
    // recurrence_key, so running it daily is the intended usage.
    materialiseUpcomingDateReminders().catch(error => {
      console.error("DATE REMINDER MATERIALISATION FAILED:", error.message);
      return { success: false, error: error.message };
    })
  ]);


  // Weekly, not daily: the bio changes slowly and rewriting it is the one
  // destructive operation in this system.
  const tz = await getUserTimezone();

  const isSunday = DateTime.now().setZone(tz).weekday === 7;

  let profileResult = { skipped: "only runs on Sundays" };

  if (isSunday) {
    try {
      profileResult = await regenerateBio();
    } catch (error) {
      console.error("BIO REGENERATION FAILED:", error.message);
      profileResult = { success: false, error: error.message };
    }
  }


  // Metrics roll up after completions and the cascade so the day's row
  // reflects them, and the observer runs last so it sees the fresh numbers.
  let metricsResult = null;
  let observationResult = null;

  try {
    metricsResult = await rollupDailyMetrics();
  } catch (error) {
    console.error("METRICS ROLLUP FAILED:", error.message);
    metricsResult = { success: false, error: error.message };
  }

  try {
    observationResult = await runDailyObservation();
  } catch (error) {
    console.error("DAILY OBSERVATION FAILED:", error.message);
    observationResult = { success: false, error: error.message };
  }


  return {
    success: true,
    completions: completionResult,
    metrics: metricsResult,
    observation: observationResult,
    nudges: nudgeResult,
    projects: projectResult,
    relationships: relationshipResult,
    dateReminders: dateReminderResult,
    profile: profileResult
  };

}


const JOBS = {
  morningBrief,
  syncCanvas,
  reviewIntentions,
  syncNews
};


export default async function handler(req, res) {

  // Vercel Cron sends this header when CRON_SECRET is set on the project.
  //
  // The check used to be a bare `auth !== \`Bearer ${process.env.CRON_SECRET}\``,
  // which with the variable unset compared against the literal string
  // "Bearer undefined" — so anyone sending exactly that was authenticated.
  // That is the first thing anyone probing a Vercel app tries, and it would
  // have let them trigger reviewIntentions repeatedly: one LLM call per open
  // intention, real push notifications, and on Sundays regenerateBio(), the
  // one destructive operation in this system.
  //
  // Dormant-when-unset is kept deliberately (same pattern as lib/auth.js —
  // enforcement can be switched on without a redeploy), but it is now loud in
  // the logs and can never be satisfied by a guessable placeholder.
  const secret = process.env.CRON_SECRET;

  if (!secret) {

    console.warn(
      "CRON_SECRET is not set — cron routes are UNAUTHENTICATED. Set it in Vercel."
    );

  } else if (req.headers.authorization !== `Bearer ${secret}`) {

    return res.status(401).json({ error: "Unauthorized" });

  }


  const { job } = req.query;

  const run = JOBS[job];

  if (!run) {
    return res.status(404).json({ error: `Unknown cron job: ${job}` });
  }


  try {

    return res.status(200).json(await run());

  } catch (error) {

    console.error(`CRON ${job} FAILED:`, error.message);

    return res.status(500).json({ error: error.message });

  }

}
