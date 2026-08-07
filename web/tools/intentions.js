import { saveDeduped } from "../lib/dedupe.js";
import { createIntention } from "./database.js";


export async function saveIntention({
  content
}) {


  if (!content) {
    throw new Error("An intention requires content.");
  }


  // Intentions are captured on a deliberately wide net — "I've been meaning
  // to..." in passing is enough — so the same goal gets restated often, and in
  // different words each time. Without this, one goal became several open
  // intentions and each one got nudged about separately.
  const result = await saveDeduped({
    table: "intentions",
    content,
    kind: "intention",
    extraFields: { status: "open" }
  });


  return {

    ...result,

    message: result.message || "Got it — I'll keep an eye on that.",

    data: result.data

  };

}
