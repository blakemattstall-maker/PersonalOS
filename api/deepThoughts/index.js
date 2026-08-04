import { getPendingDeepThoughts, resolveDeepThought, getThreadTurns } from "../../tools/database.js";
import { respondToThread, buildPlan } from "../../tools/thread.js";


export default async function handler(req, res) {

  if (req.method === "GET") {

    try {

      if (req.query.turns) {

        const turns = await getThreadTurns(req.query.turns);

        return res.status(200).json({ success: true, turns });

      }

      const thoughts = await getPendingDeepThoughts();

      return res.status(200).json({
        success: true,
        thoughts
      });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  if (req.method === "POST") {

    try {

      const { action, id, message } = req.body;


      if (!action || action === "resolve") {

        if (!id) {
          return res.status(400).json({ error: "Missing id" });
        }

        await resolveDeepThought(id);

        return res.status(200).json({ success: true });

      }


      if (action === "respond") {

        if (!id || !message) {
          return res.status(400).json({ error: "Missing id or message" });
        }

        const result = await respondToThread({ deep_thought_id: id, message });

        return res.status(200).json(result);

      }


      if (action === "buildPlan") {

        if (!id) {
          return res.status(400).json({ error: "Missing id" });
        }

        const result = await buildPlan({ deep_thought_id: id });

        return res.status(200).json(result);

      }


      return res.status(400).json({ error: `Unknown action: ${action}` });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  return res.status(405).json({
    error: "Method not allowed"
  });

}
