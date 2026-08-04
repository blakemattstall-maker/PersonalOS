import openai from "../lib/openai.js";
import { createDeepThoughtRecord } from "./database.js";


export async function startDeepThinking({
  topic
}) {


  if (!topic) {
    throw new Error("Deep thinking requires a topic.");
  }


  const response = await openai.chat.completions.create({

    model: "gpt-4o",

    messages: [

      {
        role: "system",

        content: `
You are PersonalOS doing deep, structured thinking on behalf of the user
about a real decision they're facing.

Write a thorough breakdown covering, in this order:

- A brief restatement of the decision, so the user knows you understood it
- Pros — every genuine one that applies, not padded with filler
- Cons — same standard
- A short synthesis: what would actually tip this one way or the other,
  and any question worth the user answering themselves before deciding

Be specific to what they told you, not generic advice. Plain text only —
no markdown symbols, no "#" headers. Use blank lines between sections
instead, since this is read on a plain page.
`
      },

      {
        role: "user",
        content: topic
      }

    ]

  });


  const content = response.choices[0].message.content;


  const record = await createDeepThoughtRecord({ topic, content });


  return {

    success: true,

    message: "I've thought it through — check your dashboard for the full breakdown.",

    data: {
      id: record.id,
      topic
    }

  };

}
