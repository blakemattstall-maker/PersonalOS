import supabase from "../lib/supabase.js";


export async function saveMemory(
  type,
  content,
  importance = 5
) {

  const { data, error } = await supabase
    .from("memories")
    .insert([
      {
        type,
        content,
        importance
      }
    ])
    .select()
    .single();


  if (error) {
    throw new Error(error.message);
  }


  return {
    success: true,
    message: "Memory saved.",
    data
  };
}



export async function getMemories(
  limit = 10
) {

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .order("importance", {
      ascending: false
    })
    .limit(limit);


  if (error) {
    throw new Error(error.message);
  }


  return data;
}



export async function getFormattedMemories(
  limit = 20
) {

  const memories = await getMemories(limit);


  const grouped = {};


  memories.forEach(memory => {

    if (!grouped[memory.type]) {
      grouped[memory.type] = [];
    }


    grouped[memory.type].push({
      content: memory.content,
      importance: memory.importance
    });

  });


  return grouped;

}