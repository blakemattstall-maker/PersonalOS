import { getGoogleClient } from "../lib/google.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import { createTaskRecord, updateTaskGoogleId, findRecentDuplicateTask, getTaskById, updateTaskDueDateRecord, syncTaskByGoogleId, deleteTaskRowByGoogleId } from "../tools/database.js";


export async function createTask({
  title,
  year,
  month,
  day,
  hour = 9,
  minute = 0,
  timezone = null,
  goal_id = null,
  project_id = null,
  canvas_assignment_id = null,
  notes = null,
  sequence_order = null,
  person_id = null,
  // Set only by the yearly-reminder job. The unique index on this column is
  // what makes that job idempotent — see docs/schema-accountability.sql.
  recurrence_key = null
}) {


  const tz = timezone || await getUserTimezone();


  const { auth, google } = await getGoogleClient();

  const tasks = google.tasks({
    version: "v1",
    auth
  });


  let due = null;
  let due_iso = null;


  if (year && month && day) {

    const date = DateTime.fromObject(
      {
        year,
        month,
        day,
        hour,
        minute
      },
      {
        zone: tz
      }
    );


    if (!date.isValid) {
      throw new Error(
        `Invalid task date: ${date.invalidReason}`
      );
    }

    due_iso = date.toISO();
    due = date.toUTC().toISO();

  }

  const duplicate = await findRecentDuplicateTask({
    title,
    due_date: due_iso
  });


  if (duplicate) {

    console.log("DUPLICATE BLOCKED:", title);

    return {
      success: true,
      duplicate: true,
      message: `Task "${title}" was already created moments ago.`,
      data: null,
      supabase_id: duplicate.id
    };

  }

  const supabaseRecord = await createTaskRecord({
    title,
    due_date: due_iso,
    goal_id,
    project_id,
    canvas_assignment_id,
    sequence_order,
    person_id,
    recurrence_key
  });

  // The unique index on recurrence_key already held this year's reminder, so
  // the yearly job has run before for this date. Stop here rather than
  // creating a second copy in Google.
  if (supabaseRecord?.duplicate) {

    return {
      success: true,
      duplicate: true,
      message: `Reminder "${title}" already exists for this occurrence.`,
      data: null
    };

  }


  const response = await tasks.tasks.insert({

    tasklist: "@default",

    requestBody: {
      title,
      ...(due && { due }),
      ...(notes && { notes })
    }

  });


  await updateTaskGoogleId(
    supabaseRecord.id,
    response.data.id
  );


  return {
    success: true,
    message: `Created task "${title}"`,
    data: response.data,
    supabase_id: supabaseRecord.id
  };

}


// Google Tasks records a DATE, not a moment — it discards the time portion and
// hands the date back as UTC midnight ("2026-08-13T00:00:00.000Z"). Reading
// that as a timestamp and converting to a timezone west of UTC rolls it back a
// day, so every due date displayed to a US user was a day early and tasks were
// called overdue before they were. Always read a task due through this.
export function taskDueDate(due) {

  if (!due) return null;

  return DateTime.fromISO(due, { zone: "utc" });

}


export async function getTasks({ maxResults = 100 } = {}) {

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({
    version: "v1",
    auth
  });

  const response = await tasksApi.tasks.list({

    tasklist: "@default",

    maxResults,

    // Only open tasks — completed ones aren't relevant to "what's on my plate"
    showCompleted: false,
    showHidden: false

  });

  // Slim the payload down before it ever reaches the AI
  const tasks = (response.data.items || []).map(task => ({

    id: task.id,

    title: task.title,

    // Google Tasks only stores a due date, never a time
    due: task.due || null,

    notes: task.notes || null

  }));

  return {

    success: true,

    count: tasks.length,

    tasks

  };

}



// The normal read path hides completed tasks — right for "what's on my plate",
// useless for "what did I actually get done". Google records its own completion
// timestamp, so this is the authoritative history rather than an inference.
export async function getCompletedTasks({ sinceISO, maxResults = 250 } = {}) {

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({ version: "v1", auth });

  const response = await tasksApi.tasks.list({
    tasklist: "@default",
    maxResults,
    showCompleted: true,
    showHidden: true,
    ...(sinceISO && { completedMin: sinceISO })
  });

  return (response.data.items || [])
    .filter(t => t.status === "completed" && t.completed)
    .map(t => ({
      id: t.id,
      title: t.title || "(untitled)",
      due: t.due || null,
      completed: t.completed
    }));

}


export async function getTaskStatus(google_task_id) {

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({ version: "v1", auth });

  const response = await tasksApi.tasks.get({
    tasklist: "@default",
    task: google_task_id
  });

  return response.data.status;

}



export async function updateTaskDueDate({
  supabase_id,
  newDueISO
}) {

  const taskRow = await getTaskById(supabase_id);

  const tz = await getUserTimezone();

  const due = DateTime.fromISO(newDueISO, { zone: tz }).toUTC().toISO();


  if (taskRow.google_task_id) {

    const { auth, google } = await getGoogleClient();

    const tasksApi = google.tasks({ version: "v1", auth });

    await tasksApi.tasks.patch({
      tasklist: "@default",
      task: taskRow.google_task_id,
      requestBody: { due }
    });

  }


  await updateTaskDueDateRecord(supabase_id, newDueISO);

  return { success: true };

}



export async function deleteGoogleTask(google_task_id) {

  if (!google_task_id) return;

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({ version: "v1", auth });

  try {
    await tasksApi.tasks.delete({ tasklist: "@default", task: google_task_id });
  } catch (error) {
    // Already gone on Google's side is fine — not a failure.
    if (!String(error.message).includes("404")) throw error;
  }

}



// --- Modifications keyed off the Google id ---
//
// Google is the source of truth for tasks: most of them were created in the
// Tasks app and have no local row at all, so these take the Google id the
// read path already returns and mirror into Supabase only if a row exists.

export async function completeTaskByGoogleId(google_task_id) {

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({ version: "v1", auth });

  const { data } = await tasksApi.tasks.patch({
    tasklist: "@default",
    task: google_task_id,
    requestBody: {
      status: "completed",
      completed: new Date().toISOString()
    }
  });

  await syncTaskByGoogleId(google_task_id, { status: "completed" });

  return data;

}



export async function rescheduleTaskByGoogleId({
  google_task_id,
  year,
  month,
  day,
  hour = 9,
  minute = 0,
  timezone = null
}) {

  const tz = timezone || await getUserTimezone();

  const date = DateTime.fromObject({ year, month, day, hour, minute }, { zone: tz });

  if (!date.isValid) {
    throw new Error(`Invalid task date: ${date.invalidReason}`);
  }

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({ version: "v1", auth });

  await tasksApi.tasks.patch({
    tasklist: "@default",
    task: google_task_id,
    requestBody: { due: date.toUTC().toISO() }
  });

  await syncTaskByGoogleId(google_task_id, { due_date: date.toISO() });

  return date;

}



export async function deleteTaskByGoogleId(google_task_id) {

  await deleteGoogleTask(google_task_id);

  await deleteTaskRowByGoogleId(google_task_id);

}