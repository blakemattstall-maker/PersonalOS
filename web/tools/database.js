import supabase from "../lib/supabase.js";
import { getUserTimezone } from "../lib/profile.js";
import { linkText } from "../lib/links.js";


function missingColumn(error) {
  // PostgREST rejects an unknown column in the payload regardless of its
  // value — so this has to be checked even when person_id is null, or every
  // ordinary create_event call breaks the moment person_id is added here,
  // for as long as docs/schema-people.sql hasn't been run yet.
  return ["42703", "PGRST204"].includes(error?.code)
    || /could not find.*column/i.test(error?.message || "");
}


export async function createCalendarEventRecord({
  title,
  start_time,
  end_time,
  timezone = null,
  location = null,
  description = null,
  goal_id = null,
  project_id = null,
  person_id = null,
  color_id = null,
  recurrence = null
}) {


  const tz = timezone || await getUserTimezone();

  const base = { title, start_time, end_time, timezone: tz, location, description, goal_id, project_id };

  // Columns that arrive with a migration. Each is attached only when it
  // carries something, because PostgREST rejects the whole insert for
  // containing a key it doesn't recognise — regardless of the value — so an
  // unconditional null here would break every ordinary create_event call for
  // as long as the migration is pending.
  const optional = {
    ...(person_id ? { person_id } : {}),
    ...(color_id ? { color_id } : {}),
    ...(recurrence ? { recurrence } : {})
  };


  let { data, error } = await supabase
    .from("calendar_events")
    .insert([{ ...base, ...optional }])
    .select()
    .single();

  // Retry with the columns that have always existed. The event is worth far
  // more than the metadata on it: losing a colour is cosmetic, losing the
  // event because a migration is pending is not.
  if (error && Object.keys(optional).length > 0 && missingColumn(error)) {

    ({ data, error } = await supabase
      .from("calendar_events")
      .insert([base])
      .select()
      .single());

  }

  if (error) {
    throw new Error(error.message);
  }


  await linkText({ type: "event", id: data.id, text: title });


  return data;

}



export async function updateCalendarGoogleId(
  id,
  google_event_id
) {


  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      google_event_id
    })
    .eq("id", id)
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function createTaskRecord({
  title,
  due_date = null,
  status = "pending",
  priority = null,
  goal_id = null,
  project_id = null,
  canvas_assignment_id = null,
  sequence_order = null,
  person_id = null,
  recurrence_key = null
}) {


  const base = {
    title,
    due_date,
    status,
    priority,
    goal_id,
    project_id,
    canvas_assignment_id,
    sequence_order
  };

  // Same conditional-column rule as calendar events — see above.
  const optional = {
    ...(person_id ? { person_id } : {}),
    ...(recurrence_key ? { recurrence_key } : {})
  };


  let { data, error } = await supabase
    .from("tasks")
    .insert([{ ...base, ...optional }])
    .select()
    .single();

  // A recurrence_key collision is the unique index doing its job: this exact
  // reminder already exists for this year. Report it rather than treating it
  // as a failure, so the caller can skip creating a duplicate in Google too.
  if (error?.code === "23505" && recurrence_key) {
    return { duplicate: true };
  }

  if (error && Object.keys(optional).length > 0 && missingColumn(error)) {

    ({ data, error } = await supabase
      .from("tasks")
      .insert([base])
      .select()
      .single());

  }


  if (error) {
    throw new Error(error.message);
  }


  // "Call mom about the lease" names a person and possibly a project, and
  // until now that connection did not exist until the next morning's rebuild.
  await linkText({ type: "task", id: data.id, text: title });


  return data;

}



export async function findTaskByCanvasId({
  canvas_assignment_id
}) {


  // google_task_id rides along so the caller can tell a synced task from a
  // half-create: createTask writes this mirror row BEFORE the Google insert,
  // so a row existing proves only that a sync was attempted, not that it
  // landed. The canvas sync treats null google_task_id as "redo this one".
  const { data, error } = await supabase
    .from("tasks")
    .select("id, google_task_id")
    .eq("canvas_assignment_id", canvas_assignment_id)
    .limit(1);


  if (error) {
    console.error("CANVAS DUPLICATE CHECK FAILED:", error.message);
    return null;
  }


  return data?.[0] || null;

}



export async function updateTaskGoogleId(
  id,
  google_task_id
) {


  const { data, error } = await supabase
    .from("tasks")
    .update({
      google_task_id
    })
    .eq("id", id)
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getTaskById(id) {


  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getEventById(id) {


  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("id", id)
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function findRecentDuplicateEvent({
  title,
  start_time,
  windowMinutes = 2
}) {


  const cutoff = new Date(
    Date.now() - windowMinutes * 60 * 1000
  ).toISOString();


  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("title", title)
    .eq("start_time", start_time)
    .gte("created_at", cutoff)
    .limit(1);


  // A failed duplicate check must never block a legitimate create.
  if (error) {
    console.error("DUPLICATE CHECK FAILED:", error.message);
    return null;
  }


  return data?.[0] || null;

}



export async function createBrief({
  content
}) {


  const { data, error } = await supabase
    .from("briefs")
    .insert([
      {
        content,
        unread: true
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function createBodyweightLog({
  weight,
  unit = "lbs"
}) {


  const { data, error } = await supabase
    .from("bodyweight_logs")
    .insert([
      {
        weight,
        unit
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getRecentBodyweightLogs({
  limit = 10
} = {}) {


  const { data, error } = await supabase
    .from("bodyweight_logs")
    .select("weight, unit, logged_at")
    .order("logged_at", { ascending: false })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function createDeepThoughtPlaceholder({
  topic
}) {


  const { data, error } = await supabase
    .from("deep_thoughts")
    .insert([
      {
        topic,
        content: "",
        status: "thinking"
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function updateDeepThoughtResult({
  id,
  content,
  status
}) {


  const { data, error } = await supabase
    .from("deep_thoughts")
    .update({ content, status })
    .eq("id", id)
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



// Turns embedded via PostgREST's foreign-table select rather than a separate
// query per thought. The home page used to fetch this list, then fire one
// more backendGet per pending thought to fetch its turns — every one of those
// is a full separate round trip through a completely different Vercel
// project, each paying its own routing and invocation overhead regardless of
// how small the actual query is. With normally 1-3 pending threads that was
// 2-4 chained network hops for what is now one.
export async function getPendingDeepThoughts({
  limit = 10
} = {}) {


  const { data, error } = await supabase
    .from("deep_thoughts")
    .select("*, thread_turns(*)")
    .in("status", ["thinking", "pending_review"])
    .order("created_at", { ascending: false })
    .order("created_at", { ascending: true, foreignTable: "thread_turns" })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  // Renamed to `turns` to match what every caller already expects — the web
  // page used to build this shape itself out of two separate responses.
  return (data || []).map(({ thread_turns, ...thought }) => ({
    ...thought,
    turns: thread_turns || []
  }));

}



export async function createNoteRecord({
  content
}) {


  const { data, error } = await supabase
    .from("notes")
    .insert([
      {
        content
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getRecentNotes({
  limit = 30
} = {}) {


  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function deleteNote(id) {

  const { error } = await supabase
    .from("notes")
    .delete()
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function getAllIntentions() {


  const { data, error } = await supabase
    .from("intentions")
    .select("*")
    .order("created_at", { ascending: false });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function deleteIntention(id) {

  const { error } = await supabase
    .from("intentions")
    .delete()
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



// What the brief has already told him. Passed back into composition so today's
// brief knows what yesterday's said — without this the model rediscovered the
// same spending critique and the same standing overlap every single morning,
// each time as if for the first time.
export async function getRecentBriefs({ limit = 3 } = {}) {


  const { data, error } = await supabase
    .from("briefs")
    .select("content, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function getMostRecentBrief() {


  const { data, error } = await supabase
    .from("briefs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);


  if (error) {
    throw new Error(error.message);
  }


  return data?.[0] || null;

}



export async function getLatestUnreadBrief() {


  const { data, error } = await supabase
    .from("briefs")
    .select("*")
    .eq("unread", true)
    .order("created_at", { ascending: false })
    .limit(1);


  if (error) {
    throw new Error(error.message);
  }


  return data?.[0] || null;

}



export async function markBriefRead(id) {


  const { error } = await supabase
    .from("briefs")
    .update({ unread: false })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function findRecentDuplicateTask({
  title,
  due_date = null,
  windowMinutes = 2
}) {


  const cutoff = new Date(
    Date.now() - windowMinutes * 60 * 1000
  ).toISOString();


  let query = supabase
    .from("tasks")
    .select("*")
    .eq("title", title)
    .gte("created_at", cutoff)
    .limit(1);


  // Supabase needs .is() for null, not .eq()
  if (due_date) {
    query = query.eq("due_date", due_date);
  } else {
    query = query.is("due_date", null);
  }


  const { data, error } = await query;


  if (error) {
    console.error("DUPLICATE CHECK FAILED:", error.message);
    return null;
  }


  return data?.[0] || null;

}



export async function createIntention({
  content
}) {


  const { data, error } = await supabase
    .from("intentions")
    .insert([
      {
        content,
        status: "open"
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getOpenIntentions() {


  const { data, error } = await supabase
    .from("intentions")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: true });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function markIntentionSurfaced(id) {


  const { error } = await supabase
    .from("intentions")
    .update({ last_surfaced_at: new Date().toISOString() })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



// An intention whose moment has passed leaves the "open" pool for good.
// Stamping last_surfaced_at alone — the old behaviour — only bought three
// days of cooldown, after which the same dead intention was re-evaluated,
// re-judged expired, and re-stamped, forever: one pointless model call every
// three days per finished thing, and a pool of "open" intentions that was
// mostly history.
export async function markIntentionExpired(id) {


  const { error } = await supabase
    .from("intentions")
    .update({ status: "expired", last_surfaced_at: new Date().toISOString() })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function createNudge({
  intention_id,
  message,
  // When the phone should hear about it. Null means "right now", which is also
  // what happens if the scheduling columns have not been added yet.
  deliver_at = null
}) {


  const base = {
    intention_id,
    message,
    status: "pending_review"
  };


  // PostgREST rejects an insert containing ANY unknown column, regardless of
  // the value — trap #6. So the scheduled shape is attempted first and the
  // plain one is the fallback, which keeps nudges working on a database that
  // has not run docs/schema-nudge-scheduling.sql yet. `scheduled` tells the
  // caller which happened, so it knows whether to push immediately.
  if (deliver_at) {

    const attempt = await supabase
      .from("nudges")
      .insert([{ ...base, deliver_at }])
      .select()
      .single();

    if (!attempt.error) return { ...attempt.data, scheduled: true };

    if (!/deliver_at|column|schema cache/i.test(attempt.error.message)) {
      throw new Error(attempt.error.message);
    }

  }


  const { data, error } = await supabase
    .from("nudges")
    .insert([base])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getPendingNudges() {


  const { data, error } = await supabase
    .from("nudges")
    .select("*, intentions(content)")
    .eq("status", "pending_review")
    .order("created_at", { ascending: false });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function resolveNudge(id) {


  const { error } = await supabase
    .from("nudges")
    .update({ status: "resolved" })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function resolveDeepThought(id) {


  const { error } = await supabase
    .from("deep_thoughts")
    .update({ status: "resolved" })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function getHistory({ limit = 30 } = {}) {


  const [thoughts, nudges, briefs] = await Promise.all([

    supabase
      .from("deep_thoughts")
      .select("id, topic, content, status, created_at")
      .in("status", ["resolved"])
      .order("created_at", { ascending: false })
      .limit(limit),

    supabase
      .from("nudges")
      .select("id, message, status, created_at, intentions(content)")
      .in("status", ["resolved"])
      .order("created_at", { ascending: false })
      .limit(limit),

    supabase
      .from("briefs")
      .select("id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

  ]);


  if (thoughts.error) throw new Error(thoughts.error.message);
  if (nudges.error) throw new Error(nudges.error.message);
  if (briefs.error) throw new Error(briefs.error.message);


  return {

    thoughts: thoughts.data || [],

    nudges: nudges.data || [],

    briefs: briefs.data || []

  };

}



// --- Threads (interactive follow-up on a deep-thought) ---

export async function createThreadTurn({
  deep_thought_id,
  role,
  message
}) {


  const { data, error } = await supabase
    .from("thread_turns")
    .insert([{ deep_thought_id, role, message }])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getThreadTurns(deep_thought_id) {


  const { data, error } = await supabase
    .from("thread_turns")
    .select("*")
    .eq("deep_thought_id", deep_thought_id)
    .order("created_at", { ascending: true });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function getDeepThoughtById(id) {


  const { data, error } = await supabase
    .from("deep_thoughts")
    .select("*")
    .eq("id", id)
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function updateDeepThoughtThread({
  id,
  content,
  thread_status,
  project_id
}) {


  const updates = {};

  if (content !== undefined) updates.content = content;
  if (thread_status !== undefined) updates.thread_status = thread_status;
  if (project_id !== undefined) updates.project_id = project_id;


  const { data, error } = await supabase
    .from("deep_thoughts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



// --- Goals & Projects ---

export async function createGoal({
  title,
  description = null,
  deadline = null,
  priority = null
}) {


  const { data, error } = await supabase
    .from("goals")
    .insert([{ title, description, deadline, priority, status: "active", progress: 0 }])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function createProject({
  goal_id = null,
  name,
  description = null,
  next_action = null
}) {


  const { data, error } = await supabase
    .from("projects")
    .insert([{ goal_id, name, description, next_action, status: "active" }])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function updateProject({
  id,
  status,
  next_action
}) {


  const updates = {};

  if (status !== undefined) updates.status = status;
  if (next_action !== undefined) updates.next_action = next_action;


  const { error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function getActiveProjects() {
  return getProjectsByStatus("active");
}


// "archived" is not a separate table or a special-cased flag — it's the same
// free-text status column createProject/updateProject already write, so
// putting a project away costs no migration. Only "active" and "archived" are
// reachable from the UI; "completed" exists in the column's history but
// nothing currently writes it.
export async function getProjectsByStatus(status) {


  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function getProjectsWithDetails({ status = "active" } = {}) {


  const projects = await getProjectsByStatus(status);


  const withDetails = await Promise.all(
    projects.map(async (project) => {

      const [tasksResult, materials] = await Promise.all([

        supabase
          .from("tasks")
          .select("*")
          .eq("project_id", project.id)
          .order("sequence_order", { ascending: true }),

        getProjectMaterials(project.id)

      ]);

      return {
        ...project,
        tasks: tasksResult.data || [],
        materials
      };

    })
  );


  return withDetails;

}



export async function createProjectMaterial({
  project_id,
  type,
  title,
  content
}) {


  const { data, error } = await supabase
    .from("project_materials")
    .insert([{ project_id, type, title, content }])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function getProjectMaterials(project_id) {


  const { data, error } = await supabase
    .from("project_materials")
    .select("*")
    .eq("project_id", project_id)
    .order("created_at", { ascending: false });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function getProjectTasksOrdered(project_id) {


  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", project_id)
    .order("sequence_order", { ascending: true });


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function getProjectEvents(project_id) {


  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("project_id", project_id);


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

}



export async function clearDeepThoughtProjectLink(project_id) {


  const { error } = await supabase
    .from("deep_thoughts")
    .update({ project_id: null, thread_status: "resolved" })
    .eq("project_id", project_id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function deleteProjectRecord(project_id) {


  await supabase.from("project_materials").delete().eq("project_id", project_id);
  await supabase.from("calendar_events").delete().eq("project_id", project_id);
  await supabase.from("tasks").delete().eq("project_id", project_id);

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", project_id);

  if (error) {
    throw new Error(error.message);
  }

}



// Most items live only in Google — 6 of 8 open tasks had no Supabase row,
// because anything created directly in the Tasks app never round-trips here.
// So modifications key off the Google id and treat the local row as an
// optional mirror: update it when it exists, never fail when it doesn't.
export async function findTaskByGoogleId(google_task_id) {

  if (!google_task_id) return null;

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, due_date, updated_at")
    .eq("google_task_id", google_task_id)
    .limit(1);

  if (error) {
    console.error("TASK LOOKUP BY GOOGLE ID FAILED:", error.message);
    return null;
  }

  return data?.[0] || null;

}


export async function syncTaskByGoogleId(google_task_id, updates) {

  if (!google_task_id) return;

  const { error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("google_task_id", google_task_id);

  if (error) {
    console.error("TASK MIRROR UPDATE FAILED:", error.message);
  }

}


// For rows that never got a google_task_id — the half-creates a failed Google
// insert leaves behind. Deleting by the mirror's own id is the only handle
// such a row has.
export async function deleteTaskRowById(id) {

  if (!id) return;

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("TASK ORPHAN DELETE FAILED:", error.message);
  }

}


export async function deleteTaskRowByGoogleId(google_task_id) {

  if (!google_task_id) return;

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("google_task_id", google_task_id);

  if (error) {
    console.error("TASK MIRROR DELETE FAILED:", error.message);
  }

}


export async function syncEventByGoogleId(google_event_id, updates) {

  if (!google_event_id) return;

  const { error } = await supabase
    .from("calendar_events")
    .update(updates)
    .eq("google_event_id", google_event_id);

  if (error) {
    console.error("EVENT MIRROR UPDATE FAILED:", error.message);
  }

}


export async function deleteEventRowByGoogleId(google_event_id) {

  if (!google_event_id) return;

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("google_event_id", google_event_id);

  if (error) {
    console.error("EVENT MIRROR DELETE FAILED:", error.message);
  }

}


export async function updateTaskDueDateRecord(id, due_date) {


  const { error } = await supabase
    .from("tasks")
    .update({ due_date })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}



export async function updateEventTimesRecord(id, start_time, end_time) {


  const { error } = await supabase
    .from("calendar_events")
    .update({ start_time, end_time })
    .eq("id", id);


  if (error) {
    throw new Error(error.message);
  }

}