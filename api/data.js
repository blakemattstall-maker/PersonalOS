import { getMemories, deleteMemory } from "../tools/memory.js";
import { getRecentNotes, deleteNote, getAllIntentions, deleteIntention } from "../tools/database.js";


export default async function handler(req, res) {

  if (req.method === "GET") {

    try {

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

      const { type, id } = req.body;

      if (!type || !id) {
        return res.status(400).json({ error: "Missing type or id" });
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
