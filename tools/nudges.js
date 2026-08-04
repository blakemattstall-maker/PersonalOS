import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import {
  getOpenIntentions,
  markIntentionSurfaced,
  createNudge
} from "./database.js";


async function evaluateIntention(intention, context, tz) {

  const daysSinceCreated = Math.floor(
    DateTime.now().diff(DateTime.fromISO(intention.created_at), "days").days
  );

  const daysSinceSurfaced = intention.last_surfaced_at
    ? Math.floor(DateTime.now().diff(DateTime.fromISO(intention.last_surfaced_at), "days").days)
    : null;

  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `
You are deciding whether TODAY is genuinely the right moment to nudge
the user about something they mentioned wanting to do.

Default to silence. Most days, most intentions should NOT be surfaced —
the user explicitly does not want frequent check-ins or a "20
notifications a week" experience. Only say yes when there's a real,
specific reason today is a good moment (meaningful time has passed with
no action, something in their current context makes it newly relevant,
or it's been long enough that a gentle check-in is genuinely warranted —
not just "it's been N days" on a fixed schedule).

The intention: "${intention.content}"
Said ${daysSinceCreated} day(s) ago.
${daysSinceSurfaced !== null ? `Last nudged about this ${daysSinceSurfaced} day(s) ago.` : "Never nudged about this before."}

What you know about the user:
Profile: ${context.bio || "(none)"}
Recent memories: ${JSON.stringify(context.memories, null, 2)}

Return ONLY JSON:
{
  "should_nudge": boolean,
  "message": "A short, specific, warm-but-direct nudge, written like a
    person who actually remembers what you said — not a generic
    reminder template. Include a concrete next step. Null if should_nudge
    is false."
}
`
      },

      {
        role: "user",
        content: "Evaluate this intention."
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


export async function reviewIntentionsForNudges() {

  const tz = await getUserTimezone();
  const context = await buildRichContext();

  const intentions = await getOpenIntentions();

  let nudged = 0;
  const errors = [];

  for (const intention of intentions) {

    try {

      const evaluation = await evaluateIntention(intention, context, tz);

      await markIntentionSurfaced(intention.id);

      if (evaluation.should_nudge && evaluation.message) {

        await createNudge({
          intention_id: intention.id,
          message: evaluation.message
        });

        nudged++;

      }

    } catch (error) {

      errors.push({ intention: intention.content, error: error.message });

    }

  }

  return {

    success: true,

    message: `Reviewed ${intentions.length} intention(s), ${nudged} nudge(s) created.`,

    data: { reviewed: intentions.length, nudged, errors }

  };

}
