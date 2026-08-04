import { reviewIntentionsForNudges } from "../../tools/nudges.js";
import { checkProjectDeadlines } from "../../tools/projectCheckup.js";
import { regenerateBio } from "../../tools/profileEvolution.js";
import { getUserTimezone } from "../../lib/profile.js";
import { DateTime } from "luxon";


export default async function handler(req, res) {

  const auth = req.headers.authorization;

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }


  try {

    const [nudgeResult, projectResult] = await Promise.all([
      reviewIntentionsForNudges(),
      checkProjectDeadlines()
    ]);


    // Folding the profile rewrite in here rather than adding a cron file —
    // Hobby allows 12 serverless functions and we're at exactly 12. Weekly,
    // not daily: the bio changes slowly, and rewriting it is the one
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


    return res.status(200).json({
      success: true,
      nudges: nudgeResult,
      projects: projectResult,
      profile: profileResult
    });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}
