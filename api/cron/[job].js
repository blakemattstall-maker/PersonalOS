import { syncCanvasAssignments } from "../../tools/canvas.js";
import { querySchedule } from "../../tools/schedule.js";
import { queryTasks } from "../../tools/taskQuery.js";
import { createBrief } from "../../tools/database.js";
import { reviewIntentionsForNudges } from "../../tools/nudges.js";
import { checkProjectDeadlines } from "../../tools/projectCheckup.js";
import { regenerateBio } from "../../tools/profileEvolution.js";
import { getUserTimezone } from "../../lib/profile.js";
import { DateTime } from "luxon";


// All three scheduled jobs behind one dynamic route.
//
// Vercel Hobby allows 12 serverless functions per deployment and the project
// sat at exactly 12, which blocked every planned integration — banking needs a
// link route and a webhook, location needs an ingest route. A dynamic segment
// counts as ONE function while still matching /api/cron/morningBrief,
// /api/cron/syncCanvas and /api/cron/reviewIntentions, so the schedules in
// vercel.json are untouched and the cron paths keep working exactly as before.


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


async function reviewIntentions() {

  const [nudgeResult, projectResult] = await Promise.all([
    reviewIntentionsForNudges(),
    checkProjectDeadlines()
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


  return {
    success: true,
    nudges: nudgeResult,
    projects: projectResult,
    profile: profileResult
  };

}


const JOBS = {
  morningBrief,
  syncCanvas,
  reviewIntentions
};


export default async function handler(req, res) {

  // Vercel Cron sends this header when CRON_SECRET is set on the project.
  const auth = req.headers.authorization;

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
