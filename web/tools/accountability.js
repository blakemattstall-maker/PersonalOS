import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";
import { buildRichContext } from "../lib/context.js";
import { getUserTimezone } from "../lib/profile.js";
import { getEvents } from "./googleCalendar.js";
import { analyseDay } from "../lib/eventKind.js";
import {
  getOpenIntentions,
  getProjectsWithDetails,
  getRecentBriefs,
  createNudge
} from "./database.js";
import { nextDeliveryTime, describeTodayShape, deliverNudge } from "./nudges.js";


// The accountability layer — the part that finds what he is letting slip.
//
// Intention nudges (tools/nudges.js) can only ever say back something he
// explicitly captured. But the shortcomings that actually cost people are the
// ones nobody wrote down: the internship that ended with no LinkedIn post,
// the job starting in a domain he hasn't read about, the film a friend
// recommended that has now outlived three free evenings. No intention row
// exists for any of those. This looks across everything known — memories,
// goals, projects, the calendar ahead — and writes the nudge the sharp friend
// would have sent.
//
// It shares the day's interruption budget with intention nudges rather than
// adding to it: the caller passes how much budget is left, and most days the
// answer to "what is he letting slip that hasn't been said recently?" should
// be one thing or nothing. Repetition is death for this feature — a repeated
// accountability nudge is nagging, and nagging gets muted.


const LOOKBACK_DAYS = 14;


// Everything the app has already said to him recently, whatever channel said
// it. Passed to the model as a hard do-not-repeat list — novelty enforced by
// showing the history, the same way the observer does it.
async function recentlySaid() {

  const since = DateTime.now().minus({ days: LOOKBACK_DAYS }).toISO();

  const [nudges, prompts] = await Promise.all([

    supabase
      .from("nudges")
      .select("message, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20),

    supabase
      .from("prompts")
      .select("title, body, created_at")
      .in("kind", ["digest", "relationship_checkin"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(14)

  ]);

  const said = [];

  for (const n of nudges.data || []) {
    said.push(`${DateTime.fromISO(n.created_at).toFormat("MMM d")} (nudge): ${n.message}`);
  }

  for (const p of prompts.data || []) {
    said.push(`${DateTime.fromISO(p.created_at).toFormat("MMM d")} (${p.title || "digest"}): ${p.body}`);
  }

  return said;

}


// The next few days, compact. Forward-looking on purpose: a prep gap is only
// findable by someone who can see what is coming.
async function describeDaysAhead(tz, days = 4) {

  const now = DateTime.now().setZone(tz);

  const { events } = await getEvents({
    startDate: now.toFormat("yyyy-MM-dd"),
    endDate: now.plus({ days: days - 1 }).toFormat("yyyy-MM-dd"),
    maxResults: 50
  });

  if (!events?.length) return "(nothing scheduled in the next few days)";

  const byDay = new Map();

  for (const e of events) {
    const day = DateTime.fromISO(e.start).setZone(tz).toFormat("cccc MMM d");
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e.allDay
      ? `${e.title} (all day)`
      : `${e.title} (${DateTime.fromISO(e.start).setZone(tz).toFormat("h:mma").toLowerCase()})`);
  }

  return [...byDay.entries()]
    .map(([day, list]) => `${day}: ${list.join("; ")}`)
    .join("\n");

}


export async function reviewShortcomings({ budget = 2, deliverImmediately = false, dryRun = false } = {}) {

  if (budget <= 0) {
    return { success: true, skipped: "intention nudges used today's interruption budget" };
  }

  const tz = await getUserTimezone();

  const now = DateTime.now().setZone(tz);

  // Every input degrades alone. A dead calendar costs the prep-gap and
  // free-moment shapes, not the whole review.
  const soft = (promise, fallback) => promise.catch(error => {
    console.error("ACCOUNTABILITY input unavailable:", error.message);
    return fallback;
  });

  const [context, intentions, projects, ahead, todayShape, said, briefs] = await Promise.all([
    soft(buildRichContext(), {}),
    soft(getOpenIntentions(), []),
    soft(getProjectsWithDetails({ status: "active" }), []),
    soft(describeDaysAhead(tz), "(calendar unavailable)"),
    soft(describeTodayShape(tz), null),
    soft(recentlySaid(), []),
    soft(getRecentBriefs({ limit: 1 }), [])
  ]);

  const intentionLines = (intentions || []).map(i => {
    const age = Math.floor(now.diff(DateTime.fromISO(i.created_at), "days").days);
    return `- "${i.content}" (captured ${age}d ago${i.last_surfaced_at ? "" : ", never surfaced"})`;
  });

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",
        content: `
You are the accountability layer of one person's personal operating system.
Once a day you look at everything known about him and find what he is letting
slip that a sharp friend would actually call out — then you write the push
notification that fixes it.

RIGHT NOW IT IS ${now.toFormat("cccc, d LLLL yyyy")} (${tz}), early morning.
You are planning nudges to be delivered later today, at the window you choose.

You are looking for four specific shapes:
1. FOLLOW-THROUGH DEBT — something he did or finished that the world now
   expects a next step on. An internship that ended and still no LinkedIn
   post or public word of it. A project shipped and never shared. A person
   who helped him and was never thanked.
2. PREP GAP — something coming that he is not ready for. A job starting soon
   in a domain he barely knows. A class with an exam and no review block on
   the calendar. A meeting he should walk into with three good questions.
3. FREE-MOMENT MATCH — a genuinely free window today (usually the evening)
   times something he queued and actually wants: a film someone recommended,
   a book, a call. If tonight is free and the queued thing has waited weeks,
   tonight is the answer.
4. GOAL DRIFT — a stated goal with no visible movement lately, where there is
   one concrete step he could take today.

Hard rules:
- NEVER repeat anything under ALREADY SAID, or the same idea reworded. If
  everything worth saying was said recently, return an empty list — silence
  over nagging, always.
- Do not restate what this morning's brief already covers; the brief owns
  today's schedule and its collisions. You own what is SLIPPING.
- Every message must name a concrete step doable today. "Think about X" is
  not a nudge. "Draft the LinkedIn post about the Trifilm internship tonight
  — three lines: what you built, what you learned, who you thank" is.
- Never invent facts. Every recommendation, job, goal or event you reference
  must appear verbatim somewhere in the material below.
- Blunt, specific, no softening — his explicit standing instruction. Written
  like a sharp friend who remembers what he said, never like a reminder
  template.
- Quality over count. You may return at most ${Math.min(budget, 2)}. One
  great nudge beats two decent ones. Zero is correct only when the last two
  weeks already covered everything above.

Return ONLY JSON:
{
  "nudges": [{
    "message": "the push notification text, 1-3 sentences",
    "deliver": "morning" | "midday" | "afternoon" | "evening",
    "topic": "three or four words naming the subject",
    "shape": "follow_through" | "prep_gap" | "free_moment" | "goal_drift"
  }],
  "reason": "one line: why these, or why silence"
}

Choose "deliver" by when he could actually act: an evening film is "evening",
something to do between classes is "midday".
`
      },

      {
        role: "user",
        content:
          `Who he is:\n${context.bio || "(no profile)"}\n\n` +
          `What is known about him (memories):\n${JSON.stringify(context.memories || [], null, 1)}\n\n` +
          `Where things stand (already calculated — never re-total):\n${context.signals || "(none)"}\n\n` +
          `${todayShape ? `${todayShape}\n\n` : ""}` +
          `The days ahead:\n${ahead}\n\n` +
          `Open intentions he has stated:\n${intentionLines.length ? intentionLines.join("\n") : "(none)"}\n\n` +
          `Active projects:\n${(projects || []).map(p => `- ${p.name}${p.next_action ? ` — next: ${p.next_action}` : ""}`).join("\n") || "(none)"}\n\n` +
          `THIS MORNING'S BRIEF (its territory, not yours):\n${briefs?.[0]?.content || "(none yet)"}\n\n` +
          `ALREADY SAID in the last ${LOOKBACK_DAYS} days — never repeat these or reword them:\n` +
          `${said.length ? said.map(s => `- ${s}`).join("\n") : "(nothing)"}`
      }

    ]

  });


  let verdict;

  try {
    verdict = JSON.parse(response.choices[0].message.content);
  } catch {
    return { success: false, error: "accountability verdict was not valid JSON" };
  }


  const chosen = (verdict.nudges || [])
    .filter(n => n.message)
    .slice(0, Math.min(budget, 2));


  if (dryRun) {
    return { success: true, dryRun: true, data: { chosen, reason: verdict.reason } };
  }


  const sent = [];

  for (const candidate of chosen) {

    // intention_id null on purpose: these are inferred, not captured. The
    // dashboard card, delivery pass and resolve flow all already handle a
    // nudge with no intention attached.
    const nudge = await createNudge({
      intention_id: null,
      message: candidate.message,
      deliver_at: deliverImmediately ? null : nextDeliveryTime(candidate.deliver, tz).toISO()
    });

    if (deliverImmediately || !nudge?.scheduled) {
      await deliverNudge(nudge, candidate.message);
    }

    sent.push({
      id: nudge?.id,
      topic: candidate.topic,
      shape: candidate.shape,
      deliver: candidate.deliver,
      scheduled: Boolean(nudge?.scheduled)
    });

  }


  return {
    success: true,
    message: sent.length
      ? `Raised ${sent.length} accountability nudge(s): ${sent.map(s => s.topic).join("; ")}.`
      : `Nothing raised: ${verdict.reason || "no reason given"}`,
    data: { sent, reason: verdict.reason }
  };

}
