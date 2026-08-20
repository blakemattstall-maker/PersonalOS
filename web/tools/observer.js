import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { DateTime } from "luxon";
import { buildRichContext } from "../lib/context.js";
import { getRecentMetrics } from "./metrics.js";
import { sendPush } from "../lib/push.js";
import { pushAllowed } from "../lib/settings.js";
import { getUserTimezone } from "../lib/profile.js";
import { MODELS } from "../lib/models.js";


// The observer — the part that makes this an app that initiates rather than one
// that answers.
//
// Everything else waits to be asked. This looks across every domain once a day,
// decides whether anything is genuinely worth interrupting for, and if so says
// exactly one thing.
//
// The interruption budget is a hard product constraint, not a tuning knob. The
// user was explicit that twenty notifications a week "takes the magic out of
// it", and then equally explicit that he wants the app to prompt him rather
// than be queried. Those pull in opposite directions, and the agreed resolution
// is ONE digest a day plus genuinely urgent exceptions. If he mutes this, every
// other feature dies with it — so silence is a valid and common outcome.
//
// It is also told, hard, not to invent patterns. Correlation needs weeks of
// paired history; claiming one from four days of data is how a system like this
// loses trust permanently.

const MIN_DAYS_FOR_TRENDS = 14;


function describeMetrics(metrics) {

  if (metrics.length === 0) return "(no daily history yet)";

  const fmt = m => [
    m.day,
    m.spend_total != null ? `spent $${m.spend_total}` : null,
    m.tasks_completed ? `${m.tasks_completed} done${m.tasks_completed_late ? ` (${m.tasks_completed_late} late)` : ""}` : null,
    m.calendar_busy_minutes ? `${Math.round(m.calendar_busy_minutes / 60)}h booked` : null,
    m.weight != null ? `${m.weight}lb` : null,
    m.calories_eaten != null ? `${m.calories_eaten} cal${m.protein_eaten != null ? ` / ${m.protein_eaten}g protein` : ""}` : null,
    m.places_visited != null ? `${m.places_visited} place(s)` : null
  ].filter(Boolean).join(", ");

  return metrics.slice(0, 14).map(fmt).join("\n");

}


async function openPrompts() {

  const { data } = await supabase
    .from("prompts")
    .select("id, kind, title, body")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);

  return data || [];

}


// What it has already said, answered or not.
//
// Without this the observer has no memory of its own output: it only ever saw
// prompts still pending, so the moment one was dismissed the same observation
// could be raised again the next day, and the next. Repeating yourself is the
// fastest way for a once-a-day notification to become noise — the whole budget
// is one message, and spending it on something already said is worse than
// silence.
async function recentlySaid(days = 14) {

  const since = DateTime.now().minus({ days }).toISO();

  const { data } = await supabase
    .from("prompts")
    .select("title, body, created_at, status")
    .eq("kind", "digest")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(14);

  return data || [];

}


export async function runDailyObservation({ dryRun = false } = {}) {

  const tz = await getUserTimezone();

  const [context, metrics, pending, alreadySaid] = await Promise.all([
    buildRichContext(),
    getRecentMetrics({ days: 30 }),
    openPrompts(),
    recentlySaid()
  ]);


  // Already asked something today — don't stack a second interruption on it.
  const todayKey = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");

  const { data: pushedToday } = await supabase
    .from("prompts")
    .select("id")
    .eq("kind", "digest")
    .gte("created_at", DateTime.now().setZone(tz).startOf("day").toISO())
    .limit(1);

  if (pushedToday && pushedToday.length > 0 && !dryRun) {
    return { success: true, skipped: "already sent today's digest" };
  }


  const daysOfHistory = metrics.filter(m => m.transaction_count != null || m.tasks_completed).length;


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `You are the observer for a personal operating system. Once a day
you look at everything known about the user and decide whether anything is
genuinely worth interrupting them for.

Who they are:
${context.bio || "(no profile)"}

What you know about them:
${JSON.stringify(context.memories, null, 2)}

Where things stand right now (already calculated — never re-total these):
${context.signals || "(nothing yet)"}

Daily history, newest first:
${describeMetrics(metrics)}

Bodyweight trend:
${context.bodyweightTrend || "(none)"}

Open questions already waiting for them:
${pending.length ? pending.map(p => `- [${p.kind}] ${p.body}`).join("\n") : "(none)"}

WHAT YOU HAVE ALREADY TOLD THEM in the last two weeks — do not repeat any of
these, or say the same thing in different words. If the only thing worth
saying today is something below, stay silent instead:
${alreadySaid.length
  ? alreadySaid.map(p => `- ${DateTime.fromISO(p.created_at).toFormat("MMM d")}: ${p.title} — ${p.body}`).join("\n")
  : "(nothing yet)"}

RULES — the first two matter more than being interesting:

1. SILENCE IS THE DEFAULT AND IS USUALLY CORRECT. This user said that twenty
   notifications a week "takes the magic out of it". You get ONE message a day
   at most, and most days should be none. Only speak when something is
   genuinely new, specific and actionable. Never send filler, never send a
   summary of things they already know, never send encouragement.

2. DO NOT INVENT PATTERNS. There are ${daysOfHistory} day(s) of real history.
   ${daysOfHistory < MIN_DAYS_FOR_TRENDS
     ? `That is NOT enough to claim any trend or correlation. Do not say things like "you always" or "whenever you". Stick to single concrete facts you can point at.`
     : `You may describe a trend only if the numbers above actually show it across multiple days. Point at the specific days.`}
   Any "up/down from last week" claim must come from a "Trends:" line in the
   status block above — that figure was computed for you. Do NOT eyeball the
   daily history and compute your own change; if there is no Trends line, there
   is no week-over-week claim to make. Never state a number that is not written
   above.

3. Be blunt. The user has told you to hold nothing back and never soften a
   finding for comfort. If the honest observation is uncomfortable, say it.
   No moralising, no lecturing, no therapy voice.

4. You are not a financial adviser. Describing their own spending back to them
   is fine; recommending investments is not.

Return ONLY JSON:
{
  "should_notify": boolean,
  "title": "under 40 characters, concrete, no emoji",
  "body": "1-2 sentences. Specific, blunt, actionable. Null if not notifying.",
  "reason": "why this cleared the bar today, for the log — or why you stayed silent"
}`
      },

      {
        role: "user",
        content: "Is there anything worth telling them today?"
      }

    ]

  });


  const verdict = JSON.parse(response.choices[0].message.content);


  if (!verdict.should_notify || !verdict.body) {
    return { success: true, notified: false, reason: verdict.reason };
  }


  if (dryRun) {
    return { success: true, notified: false, dryRun: true, verdict };
  }


  const { data: prompt } = await supabase
    .from("prompts")
    .insert([{
      kind: "digest",
      title: verdict.title || "Almanac",
      body: verdict.body,
      payload: { reason: verdict.reason },
      status: "pending",
      pushed_at: new Date().toISOString()
    }])
    .select()
    .single();


  // The prompt row is written either way. Turning notifications off should mean
  // "stop buzzing my phone", not "stop thinking" — the observation still shows
  // up on the dashboard next time it's opened.
  const allowed = await pushAllowed("digest");

  const push = allowed
    ? await sendPush({
        title: verdict.title || "Almanac",
        body: verdict.body,
        url: "/",
        tag: "daily-digest"
      })
    : { sent: 0, skipped: "interruption level is silent" };


  return {
    success: true,
    notified: true,
    pushed: allowed,
    prompt_id: prompt?.id,
    push,
    verdict
  };

}
