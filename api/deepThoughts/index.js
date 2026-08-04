import { getPendingDeepThoughts, resolveDeepThought, getThreadTurns, updateDeepThoughtThread } from "../../tools/database.js";
import { respondToThread, buildPlan } from "../../tools/thread.js";
import { requireAuth } from "../../lib/auth.js";


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

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


      // Escape hatch. The build runs in the background, so if the function is
      // killed mid-flight the thread would sit in "building" forever with the
      // rebuild guard blocking any retry. This lets the dashboard hand it back.
      if (action === "resetBuild") {

        if (!id) {
          return res.status(400).json({ error: "Missing id" });
        }

        await updateDeepThoughtThread({ id, thread_status: "ready_to_build" });

        return res.status(200).json({ success: true });

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
