import { syncCanvasAssignments } from "../../../../tools/canvas.js";
import { createBrief, getLatestUnreadBrief, getMostRecentBrief } from "../../../../tools/database.js";
import { composeBrief } from "../../../../tools/brief.js";
import { reviewIntentionsForNudges, deliverScheduledNudges } from "../../../../tools/nudges.js";
import { syncTransactions, rebuildLinks, findInsights, deliverInsights } from "../../../../tools/islands.js";
import { linkVisitsToEvents } from "../../../../tools/location.js";
import { checkProjectDeadlines } from "../../../../tools/projectCheckup.js";
import { regenerateBio } from "../../../../tools/profileEvolution.js";
import { syncTaskCompletions, reconcileDeletedTasks, reconcileDeletedEvents } from "../../../../tools/completions.js";
import { rollupDailyMetrics } from "../../../../tools/metrics.js";
import { runDailyObservation } from "../../../../tools/observer.js";
import { syncNewsDigest } from "../../../../tools/news.js";
import { ensureTopicsFramed } from "../../../../tools/debateTopics.js";
import { checkRelationshipCheckins, materialiseUpcomingDateReminders } from "../../../../tools/people.js";
import { getUserTimezone } from "../../../../lib/profile.js";
import { sendPush } from "../../../../lib/push.js";
import { pushAllowed } from "../../../../lib/settings.js";
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


// Writing the brief and announcing it are two jobs on two schedules, and the
// split is the whole point.
//
// They used to be one job at 6am local. That is fine until you are up at 4:30
// for a flight: the app had nothing to show you, because the brief did not exist
// yet, and the notification landed once you were airborne. Moving the single job
// to 4am would have fixed the reading and broken the sleeping — a 4am buzz every
// day for the two mornings a year you needed it.
//
// So: written at 4am, so it is already there however early the app is opened;
// announced at 6am, which is the same UTC time the push has always gone out at,
// so nothing about the notification changes.
async function morningBrief() {

  // Composed, not concatenated. This used to be
  // `Schedule: ${schedule.message}\n\nTasks: ${tasks.message}` — two tool
  // outputs glued together, which could not say which of nine calendar entries
  // mattered or tell a meeting from an hour set aside to do laundry. See
  // tools/brief.js for what it reads now and why the arithmetic stays in code.
  const brief_ = await composeBrief();

  const content = brief_.content;

  const brief = await createBrief({ content });

  // Deliberately no push here. briefPush at 6am does that.
  return { success: true, brief_id: brief.id, content, meta: brief_.data };

}


// A push body gets truncated hard by every platform, so this sends the opening
// sentence — which the brief is written to make the most important one — and
// links to the dashboard for the rest.
async function pushBrief(content) {

  const lead = (content || "").split(/(?<=[.!?])\s/)[0] || "Your brief is ready.";

  if (!await pushAllowed("digest")) {
    return { sent: 0, skipped: "interruption level" };
  }

  return sendPush({
    title: "Today",
    body: lead.length > 160 ? `${lead.slice(0, 157)}…` : lead,
    url: "/",
    // Same tag every day, so an unread brief is replaced rather than stacked —
    // yesterday's is worthless once today's exists.
    tag: "morning-brief"
  }).catch(error => {
    console.error("BRIEF PUSH FAILED:", error.message);
    return { sent: 0, error: error.message };
  });

}


async function briefPush() {

  const unread = await getLatestUnreadBrief();

  if (unread) {
    return { success: true, brief_id: unread.id, push: await pushBrief(unread.content) };
  }


  // Nothing unread, which is two very different situations and they must not be
  // treated alike: either the brief was written at 4am and has already been read
  // — silence is correct, do not buzz about something already seen — or the 4am
  // job failed and there is no brief at all.
  //
  // The second case is why this composes as a fallback. Splitting one job into
  // two means a failure in the first now costs the day's brief AND its
  // notification, where the old single job would at least have tried once. This
  // keeps that guarantee: 6am is still a moment when a brief gets made if none
  // exists.
  const timezone = await getUserTimezone();

  const today = DateTime.now().setZone(timezone).toFormat("yyyy-MM-dd");

  const recent = await getMostRecentBrief();

  const recentDay = recent
    ? DateTime.fromISO(recent.created_at, { zone: "utc" }).setZone(timezone).toFormat("yyyy-MM-dd")
    : null;

  if (recentDay === today) {
    return { success: true, skipped: "today's brief was already read" };
  }


  console.error("BRIEF MISSING AT PUSH TIME — the 4am write produced nothing; composing now.");

  const brief_ = await composeBrief();

  const brief = await createBrief({ content: brief_.content });

  return {
    success: true,
    brief_id: brief.id,
    recovered: true,
    content: brief_.content,
    push: await pushBrief(brief_.content)
  };

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
  // than added as a fourth schedule — it needs no separate cadence, and it runs
  // half an hour before the brief is written so the day's summary reflects it.
  // That gap is why every job in this chain moved when the brief did.
  const completionResult = await syncTaskCompletions();


  // Completions first, then deletions — in that order deliberately. A task
  // ticked off in Google must be recorded as done before the deletion pass
  // looks at it, or a completion could be mistaken for a disappearance and the
  // behavioural record would lose it. Both are best-effort: reconciliation is
  // housekeeping, and a Google hiccup here must not cost the day's nudges.
  const [taskReconcile, eventReconcile] = await Promise.all([
    reconcileDeletedTasks().catch(error => {
      console.error("TASK DELETION RECONCILE FAILED:", error.message);
      return { success: false, error: error.message };
    }),
    reconcileDeletedEvents().catch(error => {
      console.error("EVENT DELETION RECONCILE FAILED:", error.message);
      return { success: false, error: error.message };
    })
  ]);


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
    deletedInGoogle: { tasks: taskReconcile, events: eventReconcile },
    metrics: metricsResult,
    observation: observationResult,
    nudges: nudgeResult,
    projects: projectResult,
    relationships: relationshipResult,
    dateReminders: dateReminderResult,
    profile: profileResult
  };

}


// Delivery is its own job, run from several slots across the day. Vercel Hobby
// crons fire at most once a day each, so "spread through the day" is several
// schedules pointing at one job rather than one schedule running hourly.
async function deliverNudges() {

  // Insights ride the same slots as nudges rather than getting their own, so
  // everything the app initiates shares one interruption budget across the day
  // instead of two competing ones.
  const [nudges, insights] = await Promise.all([
    deliverScheduledNudges(),
    deliverInsights().catch(error => ({ success: false, error: error.message }))
  ]);

  return { nudges, insights };

}


// Rebuild the graph, then look at it. Sync first: a charge cannot be linked to
// a project before the charge exists as a row.
async function connectIslands() {

  const transactions = await syncTransactions({ days: 90 })
    .catch(error => ({ success: false, error: error.message }));

  const links = await rebuildLinks()
    .catch(error => ({ success: false, error: error.message }));

  // Where he was, joined to what was scheduled. Runs after rebuildLinks and
  // before findInsights for the same reason the transaction sync runs first:
  // a detector can only walk edges that already exist.
  //
  // Best-effort. Location is the one input that depends on a device outside
  // this codebase still working, so a week with no points must degrade to
  // "nothing to join" rather than costing the night's insights.
  const visits = await linkVisitsToEvents({ days: 7 })
    .catch(error => ({ success: false, error: error.message }));

  const insights = await findInsights()
    .catch(error => ({ success: false, error: error.message }));

  return { transactions, links, visits, insights };

}


const JOBS = {
  morningBrief,
  briefPush,
  syncCanvas,
  reviewIntentions,
  syncNews,
  deliverNudges,
  connectIslands
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
