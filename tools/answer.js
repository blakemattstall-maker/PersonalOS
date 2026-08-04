import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";


export async function answerQuestion({ question }) {


  if (!question) {
    throw new Error("No question provided.");
  }


  const context = await buildRichContext();


  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    messages: [

      {
        role: "system",

        content: `
You are PersonalOS, a personal assistant answering a question for your user.

What you know about this user:

${context.bio || "(no profile saved yet)"}

Recent bodyweight trend (most recent first):

${context.bodyweightTrend || "(no bodyweight data yet)"}

Recent memories:

${JSON.stringify(context.memories, null, 2)}


ANSWER STYLE:

Your answer will be read aloud or shown on a phone screen.

- Keep it short and conversational.
- Plain text only. No markdown, no bullet points, no headers.
- Two or three sentences unless more is genuinely needed.


IMPORTANT LIMITATION:

You cannot currently see the user's calendar, tasks, or finances (those
go through separate tools). If asked about their schedule, upcoming
events, to-do list, or spending, say plainly that you can't check that
here. Do not guess or invent details.

The user has explicitly told you: be blunt, hold nothing back, and
never soften a real finding for the sake of comfort.
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

    data: {
      question,
      answer
    }

  };

}