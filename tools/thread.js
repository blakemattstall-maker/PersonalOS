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



export async function buildPlan({
  deep_thought_id
}) {

  if (!deep_thought_id) {
    throw new Error("buildPlan requires deep_thought_id.");
  }

  const thought = await getDeepThoughtById(deep_thought_id);
  const document = JSON.parse(thought.content);
  const context = await buildRichContext();
  const tz = await getUserTimezone();

  const today = DateTime.now().setZone(tz);


  const response = await openai.chat.completions.create({

    model: "gpt-5.6-sol",

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
   sequence a missed deadline would cascade through.
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


  let sequence_order = 0;
  const createdTasks = [];

  for (const t of (plan.tasks || [])) {

    sequence_order += 1;

    let due;

    if (deadline && t.days_before_deadline != null) {
      due = deadline.minus({ days: t.days_before_deadline });
    } else {
      due = today.plus({ days: t.days_from_today ?? sequence_order });
    }

    const [hour, minute] = t.time_of_day
      ? t.time_of_day.split(":").map(Number)
      : [9, 0];

    const taskResult = await createTask({
      title: t.title,
      year: due.year,
      month: due.month,
      day: due.day,
      hour,
      minute,
      project_id: project.id,
      sequence_order
    });

    createdTasks.push(taskResult);

    if (t.needs_calendar_event) {

      await createEvent({
        title: t.title,
        year: due.year,
        month: due.month,
        day: due.day,
        hour,
        minute,
        project_id: project.id
      });

    }

  }


  for (const m of (plan.materials || [])) {

    await createProjectMaterial({
      project_id: project.id,
      type: m.type,
      title: m.title,
      content: m.content
    });

  }


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
