import { waitUntil } from "@vercel/functions";
import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { createDeepThoughtPlaceholder, updateDeepThoughtResult } from "./database.js";
import { MODELS } from "../lib/models.js";


async function runAnalysis({ id, topic }) {

  try {

    const context = await buildRichContext({ query: topic });

    const response = await openai.chat.completions.create({

      model: MODELS.DEEP,

      response_format: { type: "json_object" },

      messages: [

        {
          role: "system",

          content: `
You are Almanac doing sharp, decisive thinking on behalf of the user
about a real decision they're facing. You are not a neutral pros/cons
generator — you form an actual opinion and defend it. Cut to what
matters; don't pad with generic filler that would apply to anyone.

The user has explicitly told you: hold nothing back, be blunt by
nature, and never soften a finding if softening it would corrupt the
accuracy of the analysis. There is no topic that's off-limits — if
something uncomfortable is the actual answer, say it plainly. Prioritize
correctness over palatability, always.

What you already know about the user — ground everything in these real,
specific facts. If something here is directly relevant (where they live,
finances, school, career goals, existing commitments), use it explicitly:

Profile:
${context.bio || "(no profile saved yet)"}

Recent bodyweight trend (most recent first) — relevant for anything
touching fitness, health, energy, discipline, or habits:
${context.bodyweightTrend || "(no bodyweight data yet)"}

Recent memories:
${JSON.stringify(context.memories, null, 2)}

Where things actually stand right now — real figures, already calculated,
use them as fact and never re-total them:
${context.signals || "(no cross-domain data yet)"}
${context.insights ? `
What this system has already NOTICED by connecting domains — verified findings,
not guesses. Use them: acting on a pattern he has not spotted himself is the
single most valuable thing you can do here.
${context.insights}
` : ""}
${context.connections ? `
What is already connected to the things this decision names. These are
recorded connections, not guesses — a task really does belong to that
project, a charge really was for it. Use them to be specific about what
this decision would actually disturb:
${context.connections}
` : ""}
Return ONLY a JSON object with this exact shape:

{
  "verdict": "One or two sentences. Your actual recommendation, stated
    plainly — not 'it depends,' an actual lean, with a confidence level
    (e.g. 'strong lean', 'slight lean', 'genuinely close call').",
  "reasoning": "A short paragraph (3-5 sentences) defending the verdict,
    grounded in the user's specific situation above.",
  "pros": ["short, specific, non-generic pro", "..."],
  "cons": ["short, specific, non-generic con", "..."],
  "open_questions": ["a question worth the user answering themselves
    before fully committing, if any remain — omit if the case is clear"]
}

Keep every string short and dense. No filler sentences. No markdown
symbols inside the strings.
`
        },

        {
          role: "user",
          content: topic
        }

      ]

    });

    const content = response.choices[0].message.content;

    await updateDeepThoughtResult({ id, content, status: "pending_review" });


  } catch (error) {

    console.error("DEEP THINKING FAILED:", error.message);

    await updateDeepThoughtResult({
      id,
      content: JSON.stringify({
        verdict: "Something went wrong while thinking this through.",
        reasoning: error.message,
        pros: [],
        cons: [],
        open_questions: []
      }),
      status: "pending_review"
    });

  }

}


export async function startDeepThinking({
  topic
}) {


  if (!topic) {
    throw new Error("Deep thinking requires a topic.");
  }


  const placeholder = await createDeepThoughtPlaceholder({ topic });

  // Runs after this request's response is sent — the phone doesn't wait for it.
  waitUntil(runAnalysis({ id: placeholder.id, topic }));


  return {

    success: true,

    message: "On it — I'll have a full breakdown ready on your dashboard in a few minutes.",

    data: {
      id: placeholder.id,
      topic
    }

  };

}
