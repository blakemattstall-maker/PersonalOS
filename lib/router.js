import { createTask } from "../tools/googleTasks.js";
import { createEvent } from "../tools/googleCalendar.js";
import { saveMemory } from "../tools/memory.js";
import { logActivity } from "../tools/activityLog.js";


export async function executeTool(data) {

  console.log("Router received:");
  console.log(data);


  let result;


  switch(data.tool) {


    case "create_task":

      result = await createTask(
        data.title,
        data.due
      );

      break;



    case "create_event":

      result = await createEvent({
        title: data.title,
        year: data.year,
        month: data.month,
        day: data.day,
        hour: data.hour,
        minute: data.minute,
        timezone: data.timezone,
        durationMinutes: data.durationMinutes
      });

      break;



    case "save_memory":

      result = await saveMemory(
        data.type,
        data.content,
        data.importance
      );

      break;



    default:

      return {
        success:false,
        message:"Unknown tool.",
        received:data.tool
      };

  }


  await logActivity({
  action: data.tool,
  input: JSON.stringify(data),
  output: result,
  success: true,
  source: "shortcut"
});


  return result;

}