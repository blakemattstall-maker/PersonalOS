import openai from "../lib/openai.js";
import { MODELS } from "../lib/models.js";
import { computeBodyVitals } from "../lib/vitals.js";
import { getProfileBio } from "../lib/profile.js";
import { getFormattedMemories } from "./memory.js";
import { getOpenIntentions } from "./database.js";


// The tool the router never had.
//
// "Give me an analysis of my cut so far" used to scatter across
// query_finances, query_tasks, query_notes and query_projects — because the
// only bodyweight tool was log_bodyweight, a write. The finance tool ended up
// answering a body-composition question from transaction data and a stale bio
// figure, and told the user it had "no access to a weigh-in trend or start
// weight" while nineteen dated weigh-ins sat in bodyweight_logs.
//
// Everything numeric below is computed in lib/vitals.js, never by the model
// (trap #4). The model's job is judgement over settled figures: pace vs goal,
// what is going well, what to change.
export async function answerHealthQuestion({ question }) {

  if (!question) {
    throw new Error("No question provided.");
  }

  const [vitals, bio, memories, intentions, nutrition] = await Promise.all([
    computeBodyVitals(),
    getProfileBio().catch(() => null),
    getFormattedMemories({ query: question }).catch(() => null),
    getOpenIntentions().catch(() => []),
    import("./mealPlan.js").then(m => m.nutritionSignal()).catch(() => null)
  ]);


  const vitalsBlock = vitals
    ? [
        `Start: ${vitals.start.weight} ${vitals.unit} on ${vitals.start.date}`,
        `Current: ${vitals.current.weight} ${vitals.unit} on ${vitals.current.date}` +
          (vitals.daysSinceLast > 0 ? ` (${vitals.daysSinceLast} day(s) ago)` : " (today)"),
        `Total change: ${vitals.totalChange > 0 ? "+" : ""}${vitals.totalChange} ${vitals.unit} across ${vitals.count} logged weigh-ins`,
        vitals.pacePerWeek != null
          ? `Pace, last 30 days: ${vitals.pacePerWeek > 0 ? "+" : ""}${vitals.pacePerWeek} ${vitals.unit}/week`
          : `Pace, last 30 days: not computable (too few recent weigh-ins)`,
        "",
        "Recent weigh-ins (most recent first):",
        ...vitals.recent
      ].join("\n")
    : "(no weigh-ins logged yet)";


  const goalLines = (intentions || [])
    .map(i => `- ${i.content} (stated ${String(i.created_at || "").slice(0, 10) || "date unknown"})`)
    .join("\n");


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [

      {
        role: "system",
        content: `
You are Almanac, answering a question about your user's body, weight, training
or diet.

MEASURED BODY DATA — computed from his real weigh-in log. These figures are
settled facts; use them exactly as given, do NOT recompute or re-derive them,
and NEVER claim you lack access to weight data:

${vitalsBlock}

Calorie tracking: ${nutrition || "not in use — no meals have been logged, so calorie and protein intake are genuinely unknown. (He can log meals by telling the capture what he ate.)"}

His standing intentions (dated — some may be goals relevant here):

${goalLines || "(none)"}

Who he is:

${bio || "(no profile saved yet)"}

Relevant memories (dated):

${JSON.stringify(memories, null, 2)}

PRECEDENCE: the measured data block above OUTRANKS any figure in the profile
or memories. The profile is prose rewritten weekly and can lag by pounds;
the log cannot. If they disagree, the log is right — and worth saying so.

ANSWER STYLE:
- Read aloud or shown on a phone. Plain text, no markdown.
- Blunt, specific, no cheerleading — he has asked never to be softened on.
- Lead with the actual answer (the trend, the pace, the gap to goal), then at
  most a couple of sentences of what to do about it.
- If a weigh-in gap is flagged above, say plainly the trend is going blind.
`
      },

      {
        role: "user",
        content: question
      }

    ]

  });


  const answer = response.choices[0].message.content;

  return {
    success: true,
    message: answer,
    data: { question, answer, vitals }
  };

}
