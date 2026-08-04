import supabase from "../lib/supabase.js";
import { getUserTimezone } from "../lib/profile.js";


export async function createCalendarEventRecord({
  title,
  start_time,
  end_time,
  timezone = null,
  location = null,
  description = null,
  goal_id = null,
  project_id = null
}) {


  const tz = timezone || await getUserTimezone();


  const { data, error } = await supabase
    .from("calendar_events")
    .insert([
      {
        title,
        start_time,
        end_time,
        timezone: tz,
        location,
        description,
        goal_id,
        project_id
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


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
  canvas_assignment_id = null
}) {


  const { data, error } = await supabase
    .from("tasks")
    .insert([
      {
        title,
        due_date,
        status,
        priority,
        goal_id,
        project_id,
        canvas_assignment_id
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;

}



export async function findTaskByCanvasId({
  canvas_assignment_id
}) {


  const { data, error } = await supabase
    .from("tasks")
    .select("id")
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



export async function getPendingDeepThoughts({
  limit = 10
} = {}) {


  const { data, error } = await supabase
    .from("deep_thoughts")
    .select("*")
    .in("status", ["thinking", "pending_review"])
    .order("created_at", { ascending: false })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  return data || [];

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



export async function createNudge({
  intention_id,
  message
}) {


  const { data, error } = await supabase
    .from("nudges")
    .insert([
      {
        intention_id,
        message,
        status: "pending_review"
      }
    ])
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