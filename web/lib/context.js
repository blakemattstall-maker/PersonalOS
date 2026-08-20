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


// The memories object rendered as prompt-ready dated lines.
//
// Four surfaces (news ranking, the email drafter, the inbox reviewer, the doc
// writer) used to build their user context as `[bio, memories].join(...)` —
// and since memories is an object, every one of them interpolated the literal
// text "[object Object]" where the user's memories should have been, silently,
// for weeks. One renderer here, used by every string-shaped call site, makes
// that class of bug impossible to reintroduce quietly.
function formatMemoriesText(grouped) {

  const lines = [];

  for (const [type, items] of Object.entries(grouped || {})) {
    for (const m of items) {
      lines.push(`- [${type}${m.noted ? `, noted ${m.noted}` : ""}] ${m.content}`);
    }
  }

  return lines.length ? lines.join("\n") : null;

}



// For synthesis tools that reason/judge rather than just route — includes the
// full profile bio and recent bodyweight trend. The router in capture.js
// deliberately gets none of this: picking a tool and extracting arguments
// never needed it, and it was being sent on every single request.
//
// `query` is what makes memory retrieval actually relevant rather than a
// blanket dump — pass the thing the caller is reasoning about (a question, a
// deep-thinking topic, the live turn of a conversation) and only memories
// relevant to THAT come back, instead of the same top-N regardless of what's
// being asked. Omit it for callers that genuinely scan everything at once
// (the daily observer) — blanket top-N-by-importance is the correct choice
// there, not a fallback.
export async function buildRichContext({ query } = {}) {

  const tz = await getUserTimezone();

  const [memories, bio, bodyweightLogs, signals, insights, connections] = await Promise.all([
    getFormattedMemories({ query }),
    getProfileBio(),
    // Caught, unlike before: this sat uncaught in the Promise.all, so one
    // failed weigh-in read rejected the ENTIRE rich context and crashed
    // whichever tool asked — the brief survived only because gatherBriefFacts
    // wraps this call in its own settle(). An empty trend degrades one prompt
    // section; a thrown one took down the whole answer.
    getRecentBodyweightLogs({ limit: 10 }).catch(error => {
      console.error("CONTEXT bodyweight read failed — trend absent, not fatal:", error.message);
      return [];
    }),
    buildSignals({ tz }).catch(() => null),
    // What walking the entity graph noticed. Carried here rather than pushed
    // and forgotten: an insight raised last week should be context for a deep
    // thought today and a project plan tomorrow, not something that flashed on
    // a phone once. This is what makes the connections compound.
    import("../tools/islands.js").then(m => m.recentInsights({ limit: 5 })).catch(() => null),
    // The graph itself, not just what it noticed.
    //
    // `memories` above answers "what else is ABOUT this" by cosine similarity.
    // This answers "what else is CONNECTED to this", which is a different
    // question with a different answer: a project's open tasks and what it has
    // cost do not resemble a question about the project, and semantic
    // retrieval will never surface them.
    //
    // Only fires when the query actually names something on file, and returns
    // null after one cached roster lookup otherwise — so the calls that pass
    // no query (the observer, the brief, nudge review, which all scan
    // everything deliberately) pay nothing for it.
    query
      ? import("./links.js").then(m => m.connectionsForText({ text: query })).catch(() => null)
      : null
  ]);


  return {

    memories,

    // The same memories as prompt-ready dated text. Any call site that wants
    // a string interpolates THIS, never the object above.
    memoriesText: formatMemoriesText(memories),

    bio,

    bodyweightTrend: formatBodyweightTrend(bodyweightLogs, tz),

    // Cross-domain snapshot — spending, follow-through, what's overdue. Every
    // tool that reasons used to see exactly one domain, so nothing could
    // connect overspending to a week of missed deadlines. Kept to a few lines
    // on purpose: this rides in every nudge and deep thought.
    signals,

    insights,

    connections

  };

}
