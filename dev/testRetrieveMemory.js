import { getMemories } from "../web/tools/memory.js";


export default async function handler(req, res) {

  const memories = await getMemories();


  return res.status(200).json({
    success: true,
    memories
  });

}