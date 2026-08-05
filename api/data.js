import { getMemories, deleteMemory } from "../tools/memory.js";
import { answerPlaceLabel } from "../tools/location.js";
import supabase from "../lib/supabase.js";
import { getRecentNotes, deleteNote, getAllIntentions, deleteIntention } from "../tools/database.js";
import { requireAuth } from "../lib/auth.js";


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {

    try {

      // Prompts are what the app raised on its own — a place to name, a daily
      // observation. Served from here rather than a new endpoint to stay under
      // Vercel's function cap.
      if (req.query.prompts) {

        const { data, error } = await supabase
          .from("prompts")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) throw new Error(error.message);

        return res.status(200).json({ success: true, prompts: data || [] });

      }

      const [memories, notes, intentions] = await Promise.all([
        getMemories(200),
        getRecentNotes({ limit: 200 }),
        getAllIntentions()
      ]);

      return res.status(200).json({
        success: true,
        memories,
        notes,
        intentions
      });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  if (req.method === "POST") {

    try {

      const { type, id, answer } = req.body;

      if (!type || !id) {
        return res.status(400).json({ error: "Missing type or id" });
      }

      if (type === "prompt") {

        const { data: prompt } = await supabase
          .from("prompts").select("kind").eq("id", id).single();

        if (prompt?.kind === "label_place" && answer && answer !== "dismissed") {
          const result = await answerPlaceLabel({ prompt_id: id, answer });
          return res.status(200).json(result);
        }

        await supabase
          .from("prompts")
          .update({ status: "answered", answer: answer || "dismissed", answered_at: new Date().toISOString() })
          .eq("id", id);

        return res.status(200).json({ success: true });

      }

      if (type === "memory") {
        await deleteMemory(id);
      } else if (type === "note") {
        await deleteNote(id);
      } else if (type === "intention") {
        await deleteIntention(id);
      } else {
        return res.status(400).json({ error: `Unknown type: ${type}` });
      }

      return res.status(200).json({ success: true });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  return res.status(405).json({
    error: "Method not allowed"
  });

}
