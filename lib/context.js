import { getFormattedMemories } from "../tools/memory.js";


export async function buildContext() {

  const memories = await getFormattedMemories();


  return {

    memories

  };

}