import { executeTool } from "../web/lib/router.js";


export default async function handler(req, res) {

  const result = await executeTool({
    tool: "save_memory",
    type: "preference",
    content: "User prefers morning workouts.",
    importance: 8
  });


  return res.status(200).json(result);

}