import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { MODELS } from "../lib/models.js";


// The desk asks for the answer in two registers at once.
//
// The room needs a spoken line NOW — it is standing in silence — and the
// screen and dashboard need the substance. One model call writes both, spoken
// half first, so the voice can begin while the detail is still streaming out.
// The format is two labelled blocks; the split marker is chosen to never
// occur in prose.
const SPOKEN_FIRST_FORMAT = `
OUTPUT FORMAT — mandatory. Your reply MUST begin with the literal text
"SPOKEN:" and MUST contain a divider line of exactly "===". Two blocks:

SPOKEN: the sentence or two the voice says. TWO sentences — three only if
the second genuinely could not carry it. Write it the way a person plainly
states facts: subject first, ordinary declarative sentences, the direct
answer and then the one detail that matters most. FORBIDDEN: clever or
inverted openers ("The one to watch is...", "Here's the thing...",
"X is where it gets interesting"), em-dash pivots, rhetorical setups, and
any sentence shape chosen for effect rather than clarity. Contractions are
fine; no markdown, no lists recited aloud. Say only what you actually know
— never manufacture a connection to his projects or background, and NEVER
claim an action happened ("created", "drafted", "added") unless the
material explicitly says it was completed. No preamble, no closing
encouragement.
===
FULL: the complete answer — the names, numbers, options and reasoning the
small screen and the dashboard will carry. Plain text, no markdown.

Example shape (structure only, not content):
SPOKEN: You have four internships worth applying to, and Microsoft is the
most urgent because applications open in two weeks. The rest are on the
screen.
===
FULL: Four internships fit: Microsoft PM (opens ...), Amazon ...`;


export async function answerQuestion({ question, spokenFirst = false, onSpoken = null }) {


  if (!question) {
    throw new Error("No question provided.");
  }


  const context = await buildRichContext({ query: question });


  if (spokenFirst) {
    return answerSpokenFirst({ question, context, onSpoken });
  }


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [

      {
        role: "system",

        content: systemPrompt(context)
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


function systemPrompt(context, { spokenFirst = false } = {}) {

  return `
You are Almanac, a personal assistant answering a question for your user.

What you know about this user:

${context.bio || "(no profile saved yet)"}

Recent bodyweight trend (most recent first):

${context.bodyweightTrend || "(no bodyweight data yet)"}

Recent memories (dated — weigh freshness accordingly):

${JSON.stringify(context.memories, null, 2)}

Where things actually stand right now — real figures, already calculated:
${context.signals || "(none yet)"}
${context.insights ? `
Patterns the system has already noticed and verified across domains:
${context.insights}
` : ""}
${context.connections ? `
Already recorded as connected to what they just asked about. These are real
stored connections, not guesses. They are often the actual answer — if they
ask about a person or a project, this is what that person or project is
attached to:
${context.connections}
` : ""}

${spokenFirst ? SPOKEN_FIRST_FORMAT : `ANSWER STYLE:

Your answer will be read aloud or shown on a phone screen.

- Keep it short and conversational.
- Plain text only. No markdown, no bullet points, no headers.
- Two or three sentences unless more is genuinely needed.`}


IMPORTANT LIMITATION:

You cannot QUERY the user's calendar, tasks or finances — those go through
separate tools. If asked to check a schedule, list to-dos, or total up
spending, say plainly that you can't check that here, and never guess.

The exception is anything listed under connections or figures above: those
were looked up already and are real, so name them freely. "That project has
twelve open tasks and one of them is returning equipment" is a fact you were
given, not a lookup you performed. What you must not do is imply you can see
more than what is written above.

Two corollaries that matter just as much:
- The bodyweight trend and the Body/Food lines above are REAL logged data.
  Never claim you lack access to weight or body data while those sections
  hold figures.
- The dated, structured figures (weigh-ins, signals) OUTRANK any number in
  the profile or a memory. Prose lags; logs do not. If they disagree, the
  log is right.

The user has explicitly told you: be blunt, hold nothing back, and
never soften a real finding for the sake of comfort.
`;

}


// The streaming variant behind spokenFirst. Parses the two blocks as they
// arrive and fires onSpoken the moment the marker line closes the first one —
// that callback is what lets the voice start while FULL is still generating.
async function answerSpokenFirst({ question, context, onSpoken }) {

  const request = {

    model: MODELS.JUDGMENT,

    stream: true,

    // This call is a person waiting at a speaker, not a report. The
    // judgment-tier models deliberate before their first token, and that
    // deliberation is the single largest slice of the wait — dial it down
    // for the interactive surface only. Accounts/models that reject the
    // knob get one retry without it.
    reasoning_effort: "low",

    messages: [
      { role: "system", content: systemPrompt(context, { spokenFirst: true }) },
      { role: "user", content: question }
    ]

  };

  const t0 = Date.now();

  let stream;

  try {
    stream = await openai.chat.completions.create(request);
  } catch (error) {
    if (error.status === 400) {
      delete request.reasoning_effort;
      stream = await openai.chat.completions.create(request);
    } else {
      throw error;
    }
  }

  let text = "";
  let spoken = null;
  let spokenFired = false;
  let firstTokenAt = null;

  // Tolerant of the model's punctuation moods: the divider is any line of
  // three-plus equals signs, wherever its whitespace falls.
  const MARKER = /\n\s*===+/;

  for await (const part of stream) {

    const delta = part.choices?.[0]?.delta?.content || "";

    if (delta && !firstTokenAt) firstTokenAt = Date.now();

    text += delta;

    if (!spokenFired) {

      const m = text.match(MARKER);

      if (m) {

        spoken = text.slice(0, m.index).replace(/^\s*SPOKEN:\s*/i, "").trim();

        spokenFired = true;

        console.log(`SPOKEN-FIRST spoken after ${Date.now() - t0}ms (first token ${firstTokenAt - t0}ms)`);

        // Failures in the caller's early path must not kill the stream that
        // is still producing the full answer.
        if (spoken && onSpoken) {
          try { onSpoken(spoken); } catch (error) {
            console.error("onSpoken failed:", error.message);
          }
        }

      }

    }

  }

  const m = text.match(MARKER);

  console.log(`SPOKEN-FIRST done ${Date.now() - t0}ms, marker=${m ? "yes" : "NO"}, head: ${JSON.stringify(text.slice(0, 160))}`);

  // The model ignored the format: everything is one block, and the caller
  // falls back to bounding it for speech itself (onSpoken never fired).
  const full = m
    ? text.slice(m.index).replace(/^\s*===+\s*/, "").replace(/^\s*FULL:\s*/i, "").trim()
    : text.trim();

  if (m && !spokenFired) {
    spoken = text.slice(0, m.index).replace(/^\s*SPOKEN:\s*/i, "").trim();
  }

  return {

    success: true,

    message: full,

    spoken: spoken || null,

    data: {
      question,
      answer: full
    }

  };

}