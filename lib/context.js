import { getFormattedMemories } from "../tools/memory.js";
import { getProfileBio, getUserTimezone } from "./profile.js";
import { getRecentBodyweightLogs } from "../tools/database.js";
import { DateTime } from "luxon";



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



// For synthesis tools that reason/judge rather than just route — includes the
// full profile bio and recent bodyweight trend. The router in capture.js
// deliberately gets none of this: picking a tool and extracting arguments
// never needed it, and it was being sent on every single request.
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
