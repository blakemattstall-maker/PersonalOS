import { google } from "googleapis";
import { getGoogleClient } from "../lib/google.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import { createTaskRecord, updateTaskGoogleId, findRecentDuplicateTask } from "../tools/database.js";


export async function createTask({
  title,
  year,
  month,
  day,
  hour = 9,
  minute = 0,
  timezone = null,
  goal_id = null,
  project_id = null
}) {


  const tz = timezone || await getUserTimezone();


  const auth = await getGoogleClient();

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
    project_id
  });


  const response = await tasks.tasks.insert({

    tasklist: "@default",

    requestBody: {
      title,
      ...(due && { due })
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


export async function getTasks({ maxResults = 100 } = {}) {

  const auth = await getGoogleClient();

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