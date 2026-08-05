import { getFormattedMemories } from "../tools/memory.js";
import { buildSignals } from "./signals.js";
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

  const [memories, bio, bodyweightLogs, signals] = await Promise.all([
    getFormattedMemories(),
    getProfileBio(),
    getRecentBodyweightLogs({ limit: 10 }),
    buildSignals({ tz }).catch(() => null)
  ]);


  return {

    memories,

    bio,

    bodyweightTrend: formatBodyweightTrend(bodyweightLogs, tz),

    // Cross-domain snapshot — spending, follow-through, what's overdue. Every
    // tool that reasons used to see exactly one domain, so nothing could
    // connect overspending to a week of missed deadlines. Kept to a few lines
    // on purpose: this rides in every nudge and deep thought.
    signals

  };

}
