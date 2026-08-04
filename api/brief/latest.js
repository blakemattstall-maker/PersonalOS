import { getLatestUnreadBrief, markBriefRead, getMostRecentBrief } from "../../tools/database.js";
import { requireAuth } from "../../lib/auth.js";


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    // peek=true: for the frontend dashboard, which may be revisited —
    // shows the latest brief without consuming it. Default (Shortcuts):
    // only unread briefs, marked read once delivered.
    const peek = req.query.peek === "true";

    const brief = peek
      ? await getMostRecentBrief()
      : await getLatestUnreadBrief();

    if (!brief) {
      return res.status(200).json({
        success: true,
        hasBrief: false,
        message: "No new brief available."
      });
    }

    if (!peek) {
      await markBriefRead(brief.id);
    }

    return res.status(200).json({
      success: true,
      hasBrief: true,
      content: brief.content,
      created_at: brief.created_at
    });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}
