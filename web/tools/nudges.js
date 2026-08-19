import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { getFormattedMemories } from "./memory.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import {
  getOpenIntentions,
  markIntentionSurfaced,
  markIntentionExpired,
  createNudge
} from "./database.js";
import { getEvents } from "./googleCalendar.js";
import { analyseDay } from "../lib/eventKind.js";
import { mapWithConcurrency } from "../lib/async.js";
import { MODELS } from "../lib/models.js";
import { sendPush } from "../lib/push.js";
import { pushAllowed } from "../lib/settings.js";


// Nudges: deciding what is worth saying, and when in the day to say it.
//
// This was rewritten after a real failure. On the morning of Aug 7 the phone
// received three notifications at once, two of which announced that an
// internship ending "tomorrow" — it had ended the day before — and all three
// were about the same event, having already been sent the previous morning.
// Four separate faults, each fixed below and named where it is fixed.


// A hard floor, enforced in code rather than described to a model. The old
// version handed "last nudged N days ago" to the prompt as a fact and hoped;
// it re-nudged the same three intentions on consecutive mornings anyway.
const MIN_DAYS_BETWEEN_NUDGES = 3;

// The interruption budget is a product decision, not a tuning knob. More than
// this arriving at once is the thing that makes an app get muted.
const MAX_NUDGES_PER_RUN = 2;


// Delivery windows, in the user's own timezone. The point of these is that a
// nudge should land when it is actionable rather than whenever the cron
// happened to run — a "tonight, draft the message" nudge is useless at 6am and
// right at 7pm. Spread deliberately across waking hours so the app reads as
// something present through the day instead of a single morning dump.
export const DELIVERY_WINDOWS = {
  morning: 8,
  midday: 12,
  afternoon: 16,
  evening: 19
};


export function nextDeliveryTime(window, tz) {

  const now = DateTime.now().setZone(tz);

  const hour = DELIVERY_WINDOWS[window] ?? DELIVERY_WINDOWS.midday;

  const slot = now.set({ hour, minute: 0, second: 0, millisecond: 0 });

  // A window that has already passed today belongs to the next moment a person
  // would actually act on it, not to tomorrow — otherwise anything generated
  // after 19:00 silently waits a full day.
  return slot <= now ? now.plus({ minutes: 5 }) : slot;

}


// What today actually looks like, so "is today the moment?" is answerable.
// Without this the evaluator judged every intention blind to the calendar: a
// movie recommendation sat unsurfaced for two weeks of free evenings because
// nothing could ever say "tonight is free". Computed in code, stated as fact.
export async function describeTodayShape(tz) {

  const now = DateTime.now().setZone(tz);

  const todayISO = now.toFormat("yyyy-MM-dd");

  const { events } = await getEvents({ startDate: todayISO, endDate: todayISO, maxResults: 50 });

  const day = analyseDay(events || []);

  if (!day.stretches.length) {
    return "Today's calendar (already computed): completely free — nothing scheduled.";
  }

  const time = (iso) => DateTime.fromISO(iso).setZone(tz).toFormat("h:mma").toLowerCase();

  const eveningStart = now.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });

  const eveningBusy = (events || []).some(e =>
    !e.allDay && e.start && e.end && DateTime.fromISO(e.end).setZone(tz) > eveningStart
  );

  return (
    `Today's calendar (already computed): ${day.committedHours}h committed across ` +
    `${day.stretches.length} block(s); first begins ${time(day.firstStart)}, last ends ${time(day.lastEnd)}. ` +
    `The evening after 6pm is ${eveningBusy ? "NOT free" : "free"}.`
  );

}


// Exported so the date reasoning can be tested against a real stored intention
// without waiting for a cron or bypassing the cooldown by hand.
export async function evaluateIntention(intention, context, tz, dayShape = null) {

  const now = DateTime.now().setZone(tz);

  const created = DateTime.fromISO(intention.created_at).setZone(tz);

  const daysSinceCreated = Math.floor(now.diff(created, "days").days);

  const daysSinceSurfaced = intention.last_surfaced_at
    ? Math.floor(now.diff(DateTime.fromISO(intention.last_surfaced_at), "days").days)
    : null;

  const memories = await getFormattedMemories({ query: intention.content, limit: 10 })
    .catch(() => context.memories);

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `
You are deciding whether TODAY is genuinely the right moment to nudge
the user about something they mentioned wanting to do.

RIGHT NOW IT IS ${now.toFormat("cccc, d LLLL yyyy")} at ${now.toFormat("HH:mm")} (${tz}).
You are usually run before dawn, planning the whole day ahead — judge whether
SOME moment today is right, not whether this instant is, and choose the
delivery window to match that moment.
${dayShape ? `\n${dayShape}\n` : ""}

This intention was captured on ${created.toFormat("cccc, d LLLL yyyy")}, which was
${daysSinceCreated} day(s) ago.

Read any relative date inside the intention text — "tomorrow", "this Friday",
"next week", "the final day" — as relative to the day it was CAPTURED, not to
today, and work out the real calendar date before you say anything. The user
received a notification saying an event was happening "tomorrow" on a morning
when it had already happened, because that word was copied straight out of text
written two days earlier. Never repeat a relative date from the intention. If
you refer to timing at all, use the actual day.

If the moment this intention was about has already PASSED, set should_nudge to
false and set expired to true. Do not nudge someone to prepare for something
that is over; it is worse than silence.

Default to silence. Most days, most intentions should NOT be surfaced — the
user explicitly does not want frequent check-ins or a "20 notifications a week"
experience. Only say yes when there is a real, specific reason today is the
moment.

One class of exception to that default: a queued want. A film someone
recommended, a book, anything he said he wanted to do sometime — paired with a
genuinely free evening on today's calendar — IS a real reason, delivered in
the evening window. Weeks of a leisure intention sitting untouched while free
evenings pass is exactly the failure this system exists to prevent.

The user has explicitly told you: be blunt by nature, hold nothing back, and
never soften something if softening it would corrupt the accuracy of what you
are telling him. No topic is off-limits.

The intention: "${intention.content}"
${daysSinceSurfaced !== null ? `Last nudged about this ${daysSinceSurfaced} day(s) ago.` : "Never nudged about this before."}

What you know about the user:
Profile: ${context.bio || "(none)"}
Relevant memories: ${JSON.stringify(memories, null, 2)}

Where things actually stand right now — real figures, already calculated:
${context.signals || "(none yet)"}

Return ONLY JSON:
{
  "should_nudge": boolean,
  "expired": boolean,
  "deliver": "morning" | "midday" | "afternoon" | "evening",
  "topic": "three or four words naming what this is about, e.g. 'contract renewal', 'site relaunch'",
  "message": "A short, specific, blunt nudge, written like someone who actually
    remembers what you said and isn't going to dress it up — not a generic
    reminder template. Include a concrete next step. Null if should_nudge is
    false."
}

Choose "deliver" by when the user could actually act on it: something to do
before work is "morning", something to draft in the evening is "evening".
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


// Three intentions captured within seven minutes of each other — a goodbye
// message, exit-interview prep, and a thank-you post — are three rows and one
// event, and each was judged in isolation, so all three fired at once. The
// per-intention pass cannot see that; nothing had a view of the whole batch.
// This is that view.
async function chooseWhatToSend(candidates) {

  if (candidates.length <= 1) return candidates;

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",
        content:
          `Several nudges were generated independently and are about to be sent to one ` +
          `person's phone at once. Decide what actually goes out.\n\n` +
          `Send at most ${MAX_NUDGES_PER_RUN}. If two or more cover the same underlying ` +
          `event or commitment, do NOT send both — merge them into one message that keeps ` +
          `every concrete action from the ones you dropped. Getting three notifications ` +
          `about one thing is the single fastest way to make someone mute this app.\n\n` +
          `Keep the blunt, specific voice of the originals. Do not soften and do not ` +
          `summarise into vagueness.\n\n` +
          `Return ONLY JSON: {"send":[{"index":number,"message":"","deliver":"morning|midday|afternoon|evening","merged_from":[number]}]}\n` +
          `"index" is the candidate whose intention the nudge should be attached to.`
      },

      {
        role: "user",
        content: candidates
          .map((c, i) => `${i}. [topic: ${c.topic || "?"}] [deliver: ${c.deliver || "midday"}]\n${c.message}`)
          .join("\n\n")
      }

    ]

  });

  let verdict;

  try {
    verdict = JSON.parse(response.choices[0].message.content);
  } catch {
    // A malformed selection must not cost the user their nudges entirely, but
    // it also must not let the whole unfiltered batch through.
    return candidates.slice(0, MAX_NUDGES_PER_RUN);
  }

  const chosen = (verdict.send || [])
    .filter(s => candidates[s.index])
    .slice(0, MAX_NUDGES_PER_RUN)
    .map(s => ({
      ...candidates[s.index],
      message: s.message || candidates[s.index].message,
      deliver: s.deliver || candidates[s.index].deliver,
      mergedCount: (s.merged_from || []).length
    }));

  return chosen.length > 0 ? chosen : candidates.slice(0, 1);

}


export async function reviewIntentionsForNudges({ deliverImmediately = false } = {}) {

  const tz = await getUserTimezone();
  const context = await buildRichContext();

  const all = await getOpenIntentions();

  // Computed once for the whole batch — every evaluation shares one calendar
  // read. Best-effort: a dead calendar removes the free-moment reasoning, not
  // the day's nudges.
  const dayShape = await describeTodayShape(tz).catch(error => {
    console.error("NUDGE DAY-SHAPE UNAVAILABLE:", error.message);
    return null;
  });

  // The cooldown is applied before any model is called, so a recently nudged
  // intention costs nothing to skip.
  const now = DateTime.now().setZone(tz);

  const eligible = [];
  let onCooldown = 0;

  for (const intention of all) {

    const days = intention.last_surfaced_at
      ? now.diff(DateTime.fromISO(intention.last_surfaced_at), "days").days
      : Infinity;

    if (days < MIN_DAYS_BETWEEN_NUDGES) { onCooldown++; continue; }

    eligible.push(intention);

  }


  const candidates = [];
  const expired = [];
  const errors = [];

  await mapWithConcurrency(eligible, async (intention) => {

    try {

      const evaluation = await evaluateIntention(intention, context, tz, dayShape);

      if (evaluation.expired) {
        expired.push(intention.content);
        // Out of the open pool for good. A surfaced-stamp alone only bought
        // three days before the same dead intention was re-evaluated and
        // re-expired, forever.
        await markIntentionExpired(intention.id);
        return;
      }

      if (evaluation.should_nudge && evaluation.message) {
        candidates.push({
          intention,
          message: evaluation.message,
          deliver: evaluation.deliver,
          topic: evaluation.topic
        });
      }

    } catch (error) {
      errors.push({ intention: intention.content, error: error.message });
    }

  });


  // Errors used to travel only in the cron's JSON response, which Vercel
  // discards — an evaluation that failed every day for a week was invisible.
  if (errors.length) {
    console.error("NUDGE EVALUATION ERRORS:", JSON.stringify(errors));
  }


  const selected = await chooseWhatToSend(candidates).catch(() => candidates.slice(0, MAX_NUDGES_PER_RUN));

  const sent = [];

  for (const candidate of selected) {

    const nudge = await createNudge({
      intention_id: candidate.intention.id,
      message: candidate.message,
      deliver_at: deliverImmediately ? null : nextDeliveryTime(candidate.deliver, tz).toISO()
    });

    await markIntentionSurfaced(candidate.intention.id);

    // The row exists either way — muting means "stop buzzing me", not "stop
    // tracking" — so the dashboard shows it immediately regardless of when the
    // phone hears about it.
    if (deliverImmediately || !nudge?.scheduled) {
      await deliverNudge(nudge, candidate.message);
    }

    sent.push({ id: nudge?.id, deliver: candidate.deliver, scheduled: Boolean(nudge?.scheduled) });

  }


  return {
    success: true,
    message: `Reviewed ${all.length} intention(s): ${onCooldown} on cooldown, ` +
             `${candidates.length} candidate(s), ${selected.length} sent, ${expired.length} expired.`,
    data: { reviewed: all.length, onCooldown, candidates: candidates.length, sent, expired, errors }
  };

}


export async function deliverNudge(nudge, message) {

  if (!(await pushAllowed("nudge"))) return { sent: 0, skipped: "interruption level" };

  return sendPush({
    title: "Nudge",
    body: message,
    url: "/",
    tag: `nudge-${nudge?.id || Date.now()}`
  }).catch(error => {
    console.error("NUDGE PUSH FAILED:", error.message);
    return { sent: 0, error: error.message };
  });

}


// Run from several cron slots across the day. Each pass delivers only what is
// due, which is what turns a single morning dump into something that shows up
// when it is useful.
//
// Degrades on purpose: if the deliver_at/pushed_at columns have not been added
// yet (docs/schema-nudge-scheduling.sql), createNudge pushes immediately and
// this finds nothing to do, which is exactly the old behaviour.
export async function deliverScheduledNudges() {

  const { default: supabase } = await import("../lib/supabase.js");

  // The lookahead is the fix for a real, observed failure. Delivery windows
  // are local hours (8/12/16/19) while the cron slots are fixed UTC
  // (12/16/20/23 — 7am/11am/3pm/6pm CDT), so every window landed just AFTER
  // its nearest slot and waited for the next one — and the evening window
  // (7pm = 00:00 UTC) missed the day's last slot entirely. The nudges of Aug
  // 16 and 17 were written, shown on the dashboard, resolved there the next
  // morning, and never once buzzed the phone. Delivering up to 2.5 hours
  // early beats delivering tomorrow, every time.
  const horizon = DateTime.utc().plus({ minutes: 150 }).toISO();

  const { data, error } = await supabase
    .from("nudges")
    .select("id, message, deliver_at, pushed_at, status")
    .is("pushed_at", null)
    .not("deliver_at", "is", null)
    .lte("deliver_at", horizon)
    .eq("status", "pending_review")
    .order("deliver_at", { ascending: true })
    .limit(MAX_NUDGES_PER_RUN);

  if (error) {
    if (/deliver_at|pushed_at|column/i.test(error.message)) {
      return { success: true, skipped: "scheduling columns not present yet", delivered: 0 };
    }
    throw new Error(error.message);
  }

  let delivered = 0;

  for (const nudge of data || []) {

    const result = await deliverNudge(nudge, nudge.message);

    // Stamped whether or not the push went out, so a muted phone does not
    // leave a backlog that all arrives the moment the dial moves.
    await supabase.from("nudges").update({ pushed_at: new Date().toISOString() }).eq("id", nudge.id);

    if (result?.sent > 0) delivered++;

  }

  return { success: true, delivered, considered: (data || []).length };

}
