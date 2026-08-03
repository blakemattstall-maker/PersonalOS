import supabase from "../lib/supabase.js";


export async function logActivity({
  action,
  input,
  output,
  success = true,
  source = "shortcut",
  duration_ms = null,
  error_message = null
}) {

  const { data, error } = await supabase
    .from("activity_logs")
    .insert([
      {
        action,
        input,
        output,
        success,
        source,
        duration_ms,
        error_message
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return data;
}