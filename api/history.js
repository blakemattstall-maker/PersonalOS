import { getHistory } from "../tools/database.js";
import { requireAuth } from "../lib/auth.js";


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    const history = await getHistory();

    return res.status(200).json({
      success: true,
      ...history
    });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}
