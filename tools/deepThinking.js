import { waitUntil } from "@vercel/functions";
import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { createDeepThoughtPlaceholder, updateDeepThoughtResult } from "./database.js";


async function runAnalysis({ id, topic }) {

  try {

    const context = await buildRichContext();

    const response = await openai.chat.completions.create({

      model: "gpt-5.6-sol",

      response_format: { type: "json_object" },

      messages: [

        {
          role: "system",

          content: `
You are PersonalOS doing sharp, decisive thinking on behalf of the user
about a real decision they're facing. You are not a neutral pros/cons
generator — you form an actual opinion and defend it. Cut to what
matters; don't pad with generic filler that would apply to anyone.

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
