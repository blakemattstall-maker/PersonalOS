import openai from "../lib/openai.js";
import {
  getProjectsWithDetails,
  getProjectTasksOrdered,
  getProjectEvents,
  clearDeepThoughtProjectLink,
  deleteProjectRecord
} from "./database.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import { deleteGoogleTask } from "./googleTasks.js";
import { deleteGoogleEvent } from "./googleCalendar.js";
import { mapWithConcurrency } from "../lib/async.js";


export async function deleteProject({ project_id }) {

  if (!project_id) {
    throw new Error("deleteProject requires project_id.");
  }

  const [tasks, events] = await Promise.all([
    getProjectTasksOrdered(project_id),
    getProjectEvents(project_id)
  ]);

  await mapWithConcurrency(tasks, (task) => deleteGoogleTask(task.google_task_id));

  await mapWithConcurrency(events, (event) => deleteGoogleEvent(event.google_event_id));

  await clearDeepThoughtProjectLink(project_id);

  await deleteProjectRecord(project_id);

  return {

    success: true,

    message: `Deleted the project and ${tasks.length} task(s), ${events.length} event(s) — from Google too, not just here.`

  };

}


export async function queryProjects({
  question
} = {}) {

  const tz = await getUserTimezone();

  const projects = await getProjectsWithDetails();


  const formatted = projects.map(p => {

    const tasks = (p.tasks || []).map(t => {
      const due = t.due_date ? DateTime.fromISO(t.due_date).setZone(tz).toFormat("ccc MMM d") : "no date";
      return `  - ${t.title} (due ${due}, ${t.status})`;
    }).join("\n");

    return `${p.name} [${p.status}] — next action: ${p.next_action || "none set"}\n${tasks}`;

  }).join("\n\n");


  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    messages: [

      {
        role: "system",

        content: `
You are PersonalOS answering a question about the user's active projects.

Active projects (${projects.length}):

${formatted || "(no active projects)"}

RULES:
- Answer only from the data above. Never invent progress that isn't there.
- Be blunt and direct — if a project looks stalled or behind, say so plainly.
- Plain text only. No markdown, no bullets, no headers.
- Brief and conversational, read aloud or shown on a phone screen.
`
      },

      {
        role: "user",
        content: question || "How are my projects going?"
      }

    ]

  });


  const answer = response.choices[0].message.content;


  return {

    success: true,

    message: answer,

    data: { question, answer, projectCount: projects.length }

  };

}
