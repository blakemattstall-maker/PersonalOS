import { DateTime } from "luxon";
import { getUserTimezone } from "../lib/profile.js";
import { getActiveProjects, getProjectTasksOrdered } from "./database.js";
import supabase from "../lib/supabase.js";
import { getTaskStatus, updateTaskDueDate } from "./googleTasks.js";
import { updateEventTimes } from "./googleCalendar.js";
import { mapWithConcurrency } from "../lib/async.js";


async function shiftDownstreamTasks({ project_id, fromSequenceOrder, delayDays, tz }) {

  const tasks = await getProjectTasksOrdered(project_id);

  const downstream = tasks.filter(t => t.sequence_order > fromSequenceOrder && t.due_date);

  await mapWithConcurrency(downstream, (task) =>
    updateTaskDueDate({
      supabase_id: task.id,
      newDueISO: DateTime.fromISO(task.due_date).setZone(tz).plus({ days: delayDays }).toISO()
    })
  );

  return downstream.length;

}


async function shiftDownstreamEvents({ project_id, afterISO, delayDays }) {

  const { data: events, error } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("project_id", project_id)
    .gt("start_time", afterISO);

  if (error) throw new Error(error.message);

  await mapWithConcurrency(events || [], (event) =>
    updateEventTimes({
      supabase_id: event.id,
      newStartISO: DateTime.fromISO(event.start_time).plus({ days: delayDays }).toISO(),
      newEndISO: DateTime.fromISO(event.end_time).plus({ days: delayDays }).toISO()
    })
  );

  return (events || []).length;

}


export async function checkProjectDeadlines() {

  const tz = await getUserTimezone();
  const today = DateTime.now().setZone(tz).startOf("day");

  const projects = await getActiveProjects();

  let cascadesTriggered = 0;
  const errors = [];

  for (const project of projects) {

    try {

      const tasks = await getProjectTasksOrdered(project.id);

      for (const task of tasks) {

        if (!task.due_date || task.cascade_shifted) continue;
        if (!task.google_task_id) continue;

        const due = DateTime.fromISO(task.due_date).setZone(tz).startOf("day");

        if (due >= today) continue;


        const status = await getTaskStatus(task.google_task_id);

        if (status === "completed") continue;


        // Genuinely missed and not yet handled — cascade downstream items forward.
        const delayDays = Math.ceil(today.diff(due, "days").days);

        await shiftDownstreamTasks({
          project_id: project.id,
          fromSequenceOrder: task.sequence_order,
          delayDays,
          tz
        });

        await shiftDownstreamEvents({
          project_id: project.id,
          afterISO: task.due_date,
          delayDays
        });

        await supabase
          .from("tasks")
          .update({ cascade_shifted: true })
          .eq("id", task.id);

        cascadesTriggered++;

        // Stop after one cascade per project per run. The shift just rewrote
        // every downstream due date, but `tasks` is the snapshot from before
        // it — so continuing would judge later steps against stale dates and
        // double-count a miss the cascade already absorbed. (Two overdue
        // steps, -4d and -2d, pushed the tail 6 days instead of 4.) Anything
        // still genuinely missed is caught by tomorrow's run against fresh
        // data.
        break;

      }

    } catch (error) {

      errors.push({ project: project.name, error: error.message });

    }

  }

  return {

    success: true,

    message: `Checked ${projects.length} project(s), ${cascadesTriggered} deadline cascade(s) applied.`,

    data: { projectsChecked: projects.length, cascadesTriggered, errors }

  };

}
