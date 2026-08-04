import { getPendingNudges, resolveNudge } from "../../tools/database.js";
import { requireAuth } from "../../lib/auth.js";


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {

    try {

      const nudges = await getPendingNudges();

      return res.status(200).json({
        success: true,
        nudges
      });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  if (req.method === "POST") {

    try {

      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Missing id" });
      }

      await resolveNudge(id);

      return res.status(200).json({ success: true });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  return res.status(405).json({
    error: "Method not allowed"
  });

}
