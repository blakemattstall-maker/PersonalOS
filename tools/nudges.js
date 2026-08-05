import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { getFormattedMemories } from "./memory.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import {
  getOpenIntentions,
  markIntentionSurfaced,
  createNudge
} from "./database.js";
import { mapWithConcurrency } from "../lib/async.js";


async function evaluateIntention(intention, context, tz) {

  const daysSinceCreated = Math.floor(
    DateTime.now().diff(DateTime.fromISO(intention.created_at), "days").days
  );

  const daysSinceSurfaced = intention.last_surfaced_at
    ? Math.floor(DateTime.now().diff(DateTime.fromISO(intention.last_surfaced_at), "days").days)
    : null;

  // Each intention gets memories relevant to ITSELF, not the shared blanket
  // list every other intention in this run also sees — "gym" and "call mom"
  // shouldn't be judged against the same top-20-by-importance dump. The rest
  // of context (bio, signals) is genuinely shared and fetched once by the
  // caller; only the memory slice is worth re-fetching per intention.
  const memories = await getFormattedMemories({ query: intention.content, limit: 10 })
    .catch(() => context.memories);

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
or it's been long enough that a check-in is genuinely warranted — not
just "it's been N days" on a fixed schedule).

The user has explicitly told you: be blunt by nature, hold nothing
back, and never soften something if softening it would corrupt the
accuracy of what you're telling him. No topic is off-limits.

The intention: "${intention.content}"
Said ${daysSinceCreated} day(s) ago.
${daysSinceSurfaced !== null ? `Last nudged about this ${daysSinceSurfaced} day(s) ago.` : "Never nudged about this before."}

What you know about the user:
Profile: ${context.bio || "(none)"}
Relevant memories: ${JSON.stringify(memories, null, 2)}

Where things actually stand right now — real figures, already calculated:
${context.signals || "(none yet)"}

Return ONLY JSON:
{
  "should_nudge": boolean,
  "message": "A short, specific, blunt nudge, written like someone who
    actually remembers what you said and isn't going to dress it up —
    not a generic reminder template. Include a concrete next step. Null
    if should_nudge is false."
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

  // One model call per intention, previously strictly sequential at ~3.5s
  // each — which put a hard ceiling around 10 open intentions before this
  // daily cron hit Vercel's 60s limit and died halfway through. Each
  // intention is still judged entirely on its own, and each nudge is still
  // its own separate card; only the waiting happens in parallel.
  await mapWithConcurrency(intentions, async (intention) => {

    try {

      const evaluation = await evaluateIntention(intention, context, tz);

      if (evaluation.should_nudge && evaluation.message) {

        await createNudge({
          intention_id: intention.id,
          message: evaluation.message
        });

        // Only stamp this when a nudge actually goes out. Marking it on every
        // evaluation made last_surfaced_at mean "last looked at", so the prompt
        // below told the model "last nudged 0 days ago" every single day —
        // which, against a default-to-silence instruction, silenced the whole
        // system permanently after the first run.
        await markIntentionSurfaced(intention.id);

        nudged++;

      }

    } catch (error) {

      errors.push({ intention: intention.content, error: error.message });

    }

  });

  return {

    success: true,

    message: `Reviewed ${intentions.length} intention(s), ${nudged} nudge(s) created.`,

    data: { reviewed: intentions.length, nudged, errors }

  };

}
