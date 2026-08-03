import { getMemories } from "../tools/memory.js";

export default async function handler(req, res) {

  try {

    const memories = await getMemories(10);

    return res.status(200).json({
      success:true,
      memories
    });

  } catch(error){

    return res.status(500).json({
      error:error.message
    });

  }

}