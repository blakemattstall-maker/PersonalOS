import { querySchedule } from "../../tools/schedule.js";
import { queryTasks } from "../../tools/taskQuery.js";
import { createBrief } from "../../tools/database.js";
import { getUserTimezone } from "../../lib/profile.js";
import { DateTime } from "luxon";


export default async function handler(req, res) {

  // Vercel Cron automatically sends this header when CRON_SECRET is set
  // on the project. Anyone else hitting this URL gets rejected.
  const auth = req.headers.authorization;

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }


  try {

    const tz = await getUserTimezone();

    const today = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");


    const schedule = await querySchedule({
      startDate: today,
      endDate: today,
      question: "What's on my schedule today?"
    });


    const tasks = await queryTasks({
      question: "What tasks do I have?"
    });


    const content = `Schedule: ${schedule.message}\n\nTasks: ${tasks.message}`;


    const brief = await createBrief({
      content
    });


    return res.status(200).json({
      success: true,
      brief_id: brief.id,
      content
    });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}
