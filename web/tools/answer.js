import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { MODELS } from "../lib/models.js";


export async function answerQuestion({ question }) {


  if (!question) {
    throw new Error("No question provided.");
  }


  const context = await buildRichContext({ query: question });


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [

      {
        role: "system",

        content: `
You are Almanac, a personal assistant answering a question for your user.

What you know about this user:

${context.bio || "(no profile saved yet)"}

Recent bodyweight trend (most recent first):

${context.bodyweightTrend || "(no bodyweight data yet)"}

Recent memories:

${JSON.stringify(context.memories, null, 2)}

Where things actually stand right now — real figures, already calculated:
${context.signals || "(none yet)"}
${context.connections ? `
Already recorded as connected to what they just asked about. These are real
stored connections, not guesses. They are often the actual answer — if they
ask about a person or a project, this is what that person or project is
attached to:
${context.connections}
` : ""}

ANSWER STYLE:

Your answer will be read aloud or shown on a phone screen.

- Keep it short and conversational.
- Plain text only. No markdown, no bullet points, no headers.
- Two or three sentences unless more is genuinely needed.


IMPORTANT LIMITATION:

You cannot QUERY the user's calendar, tasks or finances — those go through
separate tools. If asked to check a schedule, list to-dos, or total up
spending, say plainly that you can't check that here, and never guess.

The exception is anything listed under connections or figures above: those
were looked up already and are real, so name them freely. "That project has
twelve open tasks and one of them is returning equipment" is a fact you were
given, not a lookup you performed. What you must not do is imply you can see
more than what is written above.

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