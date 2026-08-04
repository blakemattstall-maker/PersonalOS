import { waitUntil } from "@vercel/functions";
import openai from "../lib/openai.js";
import { buildContext } from "../lib/context.js";
import { createDeepThoughtPlaceholder, updateDeepThoughtResult } from "./database.js";


async function runAnalysis({ id, topic }) {

  try {

    const context = await buildContext();

    const response = await openai.chat.completions.create({

      model: "gpt-5.6-sol",

      messages: [

        {
          role: "system",

          content: `
You are PersonalOS doing deep, structured thinking on behalf of the user
about a real decision they're facing.

What you already know about the user — use it. Ground the analysis in
these specific, real facts (where they live, financial situation, school,
existing commitments, stated preferences) rather than giving generic
advice that ignores context you already have:

${JSON.stringify(context, null, 2)}

Write a thorough breakdown covering, in this order:

- A brief restatement of the decision, so the user knows you understood it
- Pros — every genuine one that applies, not padded with filler
- Cons — same standard
- A short synthesis: what would actually tip this one way or the other,
  and any question worth the user answering themselves before deciding

Be specific to what they told you and what you already know about them —
if a known fact (e.g. where they currently live, financial constraints)
is directly relevant, say so explicitly rather than leaving it implicit.
Plain text only — no markdown symbols, no "#" headers. Use blank lines
between sections instead, since this is read on a plain page.
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
      content: `Something went wrong while thinking this through: ${error.message}`,
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
