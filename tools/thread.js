import { waitUntil } from "@vercel/functions";
import openai from "../lib/openai.js";
import { buildRichContext } from "../lib/context.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import {
  getDeepThoughtById,
  getThreadTurns,
  createThreadTurn,
  updateDeepThoughtThread,
  createProject,
  createProjectMaterial
} from "./database.js";
import { createTask } from "./googleTasks.js";
import { createEvent } from "./googleCalendar.js";
import { mapWithConcurrency } from "../lib/async.js";


export async function respondToThread({
  deep_thought_id,
  message
}) {

  if (!deep_thought_id || !message) {
    throw new Error("respondToThread requires deep_thought_id and message.");
  }

  const thought = await getDeepThoughtById(deep_thought_id);
  const priorTurns = await getThreadTurns(deep_thought_id);
  const context = await buildRichContext();


  await createThreadTurn({ deep_thought_id, role: "user", message });


  const turnHistory = priorTurns
    .map(t => `${t.role === "user" ? "User" : "PersonalOS"}: ${t.message}`)
    .join("\n") || "(no messages yet)";


  const response = await openai.chat.completions.create({

    model: "gpt-5.6-sol",

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `
You are continuing an interactive planning conversation with the user
about: "${thought.topic}"

Current state of the analysis (JSON):
${thought.content}

Conversation so far:
${turnHistory}

The user just said: "${message}"

What you know about the user:
Profile: ${context.bio || "(none)"}
Recent memories: ${JSON.stringify(context.memories, null, 2)}

The user has told you to be blunt, hold nothing back, and never soften
a finding for the sake of comfort. No topic is off-limits.

Decide ONE of three things:
1. "clarify" — you need one specific piece of information before this
   is well-defined enough to plan. Ask exactly one focused question.
2. "revise" — you have enough to update the analysis. Update it, and
   describe ONLY what changed, briefly — the user does not want to see
   the whole analysis repeated, just a short summary of the delta.
3. "propose_plan" — you now have clear KPIs and a deadline (or you've
   confirmed there genuinely isn't a fixed deadline). Propose moving to
   building an actual plan (tasks, calendar events, a workback
   schedule) and ask the user to confirm.

Return ONLY JSON with this exact shape:
{
  "action": "clarify" | "revise" | "propose_plan",
  "reply": "what to show the user for this turn",
  "updated_document": {
    "verdict": "...",
    "reasoning": "...",
    "pros": ["..."],
    "cons": ["..."],
    "open_questions": ["..."],
    "kpis": ["specific, measurable success criteria, once known"],
    "deadline": "YYYY-MM-DD or null"
  }
}

Always return the full updated_document, carrying forward anything
that hasn't changed from the current state above.
`
      }

    ]

  });


  const result = JSON.parse(response.choices[0].message.content);


  await createThreadTurn({ deep_thought_id, role: "assistant", message: result.reply });


  await updateDeepThoughtThread({
    id: deep_thought_id,
    content: JSON.stringify(result.updated_document),
    thread_status: result.action === "propose_plan" ? "ready_to_build" : "clarifying"
  });


  return {

    success: true,

    message: result.reply,

    data: { action: result.action }

  };

}



// Building a plan is one gpt-5.6-sol call plus a real task/event for every
// step — 25-45s of honest work. It used to run inside the button press, which
// meant the dashboard's Server Action hit its own duration limit and showed a
// server error while the build actually carried on and succeeded in the
// background. Same ack-then-work shape as start_deep_thinking: mark it
// building, return immediately, do the work after the response is sent.
export async function buildPlan({
  deep_thought_id
}) {

  if (!deep_thought_id) {
    throw new Error("buildPlan requires deep_thought_id.");
  }

  const thought = await getDeepThoughtById(deep_thought_id);

  if (thought.thread_status === "active" && thought.project_id) {
    return {
      success: true,
      duplicate: true,
      message: "A plan was already built for this — check your Projects section.",
      data: { project_id: thought.project_id }
    };
  }

  // A second press while the first build is still running would create a whole
  // second project with a second set of real Google tasks — which is exactly
  // what happened once before, when a client timeout hid a build that had
  // actually succeeded.
  if (thought.thread_status === "building") {
    return {
      success: true,
      building: true,
      message: "Already building this plan — it'll appear under Projects shortly.",
      data: { deep_thought_id }
    };
  }

  await updateDeepThoughtThread({
    id: deep_thought_id,
    thread_status: "building"
  });

  waitUntil(runPlanBuild({ deep_thought_id }));

  return {
    success: true,
    building: true,
    message: "Building your plan now — it'll appear under Projects in a moment.",
    data: { deep_thought_id }
  };

}


async function runPlanBuild({ deep_thought_id }) {

  try {

    return await executePlanBuild({ deep_thought_id });

  } catch (error) {

    console.error("BUILD PLAN FAILED:", error.message);

    // Put it back where the user can retry, rather than stranding it in
    // "building" forever with no way out.
    await updateDeepThoughtThread({
      id: deep_thought_id,
      thread_status: "ready_to_build"
    });

  }

}


async function executePlanBuild({
  deep_thought_id
}) {

  const thought = await getDeepThoughtById(deep_thought_id);

  // Thoughts saved before structured output are plain text, not JSON.
  // Don't let one of those crash the build — plan from the raw text instead.
  let document;

  try {
    document = JSON.parse(thought.content);
  } catch (parseError) {
    document = { reasoning: thought.content, deadline: null };
  }

  const context = await buildRichContext();
  const tz = await getUserTimezone();

  const today = DateTime.now().setZone(tz);


  const response = await openai.chat.completions.create({

    // Was gpt-5.6-sol at ~22s for this call alone, which put the whole build
    // uncomfortably close to the 60s function ceiling — and a build that
    // overruns leaves the thread stuck mid-flight. Turning an already-decided
    // analysis into a sequenced task list is structured generation, not the
    // hard judgment call sol is worth paying for; terra does it in ~13s.
    // The deep thinking itself stays on sol.
    model: "gpt-5.6-terra",

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `
You are building a concrete execution plan for: "${thought.topic}"

Analysis so far (JSON):
${JSON.stringify(document, null, 2)}

Today's date: ${today.toFormat("yyyy-MM-dd")}

What you know about the user:
Profile: ${context.bio || "(none)"}
Recent memories: ${JSON.stringify(context.memories, null, 2)}

Be blunt and specific — no generic filler tasks that would apply to any project.

Generate:
1. A short project name, one-sentence description, and the single
   concrete "next action."
2. A workback schedule: an ordered list of tasks. Each needs a title
   and "days_before_deadline" (if there's a deadline in the analysis)
   or "days_from_today" (if there isn't). Order matters — this is the
   sequence a missed deadline would cascade through. Dates must move
   forward with the order: each task falls on or after the one before
   it, so days_before_deadline never increases as you go down the list,
   and nothing lands after the deadline itself. Keep titles short —
   a few words, not a sentence.
3. Mark any task that's tied to a specific time (not just a day) with
   needs_calendar_event: true and a time_of_day ("HH:MM", 24-hour).
4. Any planning material worth writing now — a short brief or
   checklist. (Live web research isn't available yet — if research
   would genuinely help, say so in a material instead of pretending to
   have looked it up.)

Return ONLY JSON:
{
  "project_name": "...",
  "project_description": "...",
  "next_action": "...",
  "tasks": [
    {
      "title": "...",
      "days_before_deadline": 7,
      "days_from_today": null,
      "needs_calendar_event": false,
      "time_of_day": null
    }
  ],
  "materials": [
    { "type": "document", "title": "...", "content": "..." }
  ]
}
`
      }

    ]

  });


  const plan = JSON.parse(response.choices[0].message.content);


  const project = await createProject({
    name: plan.project_name,
    description: plan.project_description,
    next_action: plan.next_action
  });


  const deadline = document.deadline
    ? DateTime.fromISO(document.deadline, { zone: tz })
    : null;


  // Resolve every task's slot and due date up front. sequence_order used to be
  // a counter mutated inside the loop, which can't survive running these
  // concurrently — and sequence_order is what the missed-deadline cascade
  // walks, so getting it wrong would silently corrupt rescheduling.
  let previousDue = null;

  const plannedTasks = (plan.tasks || []).map((t, index) => {

    const sequence_order = index + 1;

    const [rawHour, rawMinute] = t.time_of_day
      ? t.time_of_day.split(":").map(Number)
      : [9, 0];

    let due = (deadline && t.days_before_deadline != null)
      ? deadline.minus({ days: t.days_before_deadline })
      : today.plus({ days: t.days_from_today ?? sequence_order });

    // Compare full timestamps, not bare dates. The day and the time-of-day are
    // chosen independently by the model, so a plan can put "close RSVPs" at
    // 8pm and the next step at 9am the same morning — correct dates, backwards
    // schedule. The cascade rescheduler shifts everything after a missed step
    // by sequence_order, so the order has to actually hold.
    due = due.set({ hour: rawHour, minute: rawMinute, second: 0, millisecond: 0 });

    // Nothing may land past the deadline day, but keep its time of day —
    // clamping to the deadline itself would drag evening steps to midnight.
    if (deadline && due.startOf("day") > deadline.startOf("day")) {
      due = deadline.set({ hour: rawHour, minute: rawMinute, second: 0, millisecond: 0 });
    }

    if (previousDue && due < previousDue) {
      due = previousDue;
    }

    previousDue = due;

    return { ...t, sequence_order, due, hour: due.hour, minute: due.minute };

  });


  const createdTasks = await mapWithConcurrency(plannedTasks, async (t) => {

    const taskResult = await createTask({
      title: t.title,
      year: t.due.year,
      month: t.due.month,
      day: t.due.day,
      hour: t.hour,
      minute: t.minute,
      project_id: project.id,
      sequence_order: t.sequence_order
    });

    if (t.needs_calendar_event) {

      await createEvent({
        title: t.title,
        year: t.due.year,
        month: t.due.month,
        day: t.due.day,
        hour: t.hour,
        minute: t.minute,
        project_id: project.id
      });

    }

    return taskResult;

  });


  await mapWithConcurrency(plan.materials || [], (m) =>
    createProjectMaterial({
      project_id: project.id,
      type: m.type,
      title: m.title,
      content: m.content
    })
  );


  await updateDeepThoughtThread({
    id: deep_thought_id,
    thread_status: "active",
    project_id: project.id
  });


  return {

    success: true,

    message: `Built the plan: "${plan.project_name}" with ${createdTasks.length} tasks.`,

    data: { project_id: project.id, taskCount: createdTasks.length }

  };

}
