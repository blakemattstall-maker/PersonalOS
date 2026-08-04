import { getProjectsWithDetails, updateProject } from "../tools/database.js";


export default async function handler(req, res) {

  if (req.method === "GET") {

    try {

      const projects = await getProjectsWithDetails();

      return res.status(200).json({
        success: true,
        projects
      });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  if (req.method === "POST") {

    try {

      const { id, status, next_action } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Missing id" });
      }

      await updateProject({ id, status, next_action });

      return res.status(200).json({ success: true });

    } catch (error) {

      return res.status(500).json({ error: error.message });

    }

  }


  return res.status(405).json({
    error: "Method not allowed"
  });

}
