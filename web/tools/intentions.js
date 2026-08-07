import { saveDeduped } from "../lib/dedupe.js";
import { createIntention } from "./database.js";
import { resolveRelativeDates } from "../lib/resolveDates.js";
import { getUserTimezone } from "../lib/profile.js";


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

  // Pin "tomorrow" to a real date before it is stored. Downstream readers see
  // this text days or weeks later with no idea when it was written, and one of
  // them announced an internship ending "tomorrow" the morning after it ended.
  // Resolving once here fixes every future reader at the same time.
  const resolved = resolveRelativeDates(content, { zone: await getUserTimezone() });

  const result = await saveDeduped({
    table: "intentions",
    content: resolved,
    kind: "intention",
    extraFields: { status: "open" }
  });


  return {

    ...result,

    message: result.message || "Got it — I'll keep an eye on that.",

    data: result.data

  };

}
