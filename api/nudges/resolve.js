import { resolveNudge } from "../../tools/database.js";


export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    await resolveNudge(id);

    return res.status(200).json({ success: true });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}
