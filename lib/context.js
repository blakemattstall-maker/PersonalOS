import { getFormattedMemories } from "../tools/memory.js";
import { getProfileBio } from "./profile.js";


export async function buildContext() {

  const memories = await getFormattedMemories();


  return {

    memories

  };

}



// For synthesis tools that reason/judge rather than just route —
// includes the full profile bio. Deliberately not used by the cheap
// routing model in capture.js, which doesn't need it to classify intent.
export async function buildRichContext() {

  const [memories, bio] = await Promise.all([
    getFormattedMemories(),
    getProfileBio()
  ]);


  return {

    memories,

    bio

  };

}
