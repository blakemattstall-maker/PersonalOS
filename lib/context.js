import { getFormattedMemories } from "../tools/memory.js";
import { getProfileBio } from "./profile.js";
import { getRecentBodyweightLogs } from "../tools/database.js";
import { getUserTimezone } from "./profile.js";
import { DateTime } from "luxon";


export async function buildContext() {

  const memories = await getFormattedMemories();


  return {

    memories

  };

}



function formatBodyweightTrend(logs, timezone) {

  if (!logs || logs.length === 0) {
    return null;
  }

  return logs
    .map(log => {
      const date = DateTime.fromISO(log.logged_at).setZone(timezone).toFormat("MMM d, yyyy");
      return `${date}: ${log.weight} ${log.unit}`;
    })
    .join("\n");

}



// For synthesis tools that reason/judge rather than just route —
// includes the full profile bio and recent bodyweight trend. Deliberately
// not used by the cheap routing model in capture.js, which doesn't need
// any of this to classify intent.
export async function buildRichContext() {

  const tz = await getUserTimezone();

  const [memories, bio, bodyweightLogs] = await Promise.all([
    getFormattedMemories(),
    getProfileBio(),
    getRecentBodyweightLogs({ limit: 10 })
  ]);


  return {

    memories,

    bio,

    bodyweightTrend: formatBodyweightTrend(bodyweightLogs, tz)

  };

}
