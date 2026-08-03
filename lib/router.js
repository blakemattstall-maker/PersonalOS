import { createTask } from "../tools/googleTasks.js";
import { createEvent } from "../tools/googleCalendar.js";
import { saveMemory } from "../tools/memory.js";


export async function executeTool(data) {

  console.log("Router received:");
  console.log(JSON.stringify(data, null, 2));


  switch(data.tool) {


    case "create_task":

        return await createTask({
            title: data.title,

            year: data.year,
            month: data.month,
            day: data.day,

            hour: data.hour,
            minute: data.minute,

            timezone: data.timezone
    });


    case "create_event":

      return await createEvent(
        {
          title: data.title,

          year: data.year,
          month: data.month,
          day: data.day,

          hour: data.hour,
          minute: data.minute,

          timezone: data.timezone,

          durationMinutes: data.durationMinutes
        }
      );


    case "save_memory":

      return await saveMemory(
        data.type,
        data.content,
        data.importance
      );


    default:

      return {
        success:false,
        message:"Unknown tool.",
        received:data.tool
      };

  }

}