import { getProjectsWithDetails, updateProject } from "../tools/database.js";
import { deleteProject } from "../tools/projects.js";
import { requireAuth } from "../lib/auth.js";


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

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

      const { id, action, status, next_action } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Missing id" });
      }

      if (action === "delete") {

        const result = await deleteProject({ project_id: id });

        return res.status(200).json(result);

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
