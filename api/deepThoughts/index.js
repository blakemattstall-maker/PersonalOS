import { getPendingDeepThoughts, resolveDeepThought } from "../../tools/database.js";


export default async function handler(req, res) {

  if (req.method === "GET") {

    try {

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

      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Missing id" });
      }

      await resolveDeepThought(id);

      return res.status(200).json({ success: true });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  return res.status(405).json({
    error: "Method not allowed"
  });

}
