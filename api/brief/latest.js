import { getLatestUnreadBrief, markBriefRead } from "../../tools/database.js";


export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    const brief = await getLatestUnreadBrief();

    if (!brief) {
      return res.status(200).json({
        success: true,
        hasBrief: false,
        message: "No new brief available."
      });
    }

    await markBriefRead(brief.id);

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
