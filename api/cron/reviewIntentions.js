import { reviewIntentionsForNudges } from "../../tools/nudges.js";
import { checkProjectDeadlines } from "../../tools/projectCheckup.js";


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

    return res.status(200).json({
      success: true,
      nudges: nudgeResult,
      projects: projectResult
    });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}
