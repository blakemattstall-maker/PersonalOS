import supabase from "../lib/supabase.js";


export async function createCalendarEventRecord({
  title,
  start_time,
  end_time,
  timezone = "America/Los_Angeles",
  location = null,
  description = null,
  goal_id = null,
  project_id = null
}) {


  const { data, error } = await supabase
    .from("calendar_events")
    .insert([
      {
        title,
        start_time,
        end_time,
        timezone,
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