import { createTask } from "../tools/googleTasks.js";
import { createEvent } from "../tools/googleCalendar.js";
import { saveMemory } from "../tools/memory.js";


export async function executeTool(data) {

  console.log("Router received:");
  console.log(data);

  switch(data.tool) {

    case "create_task":

      return await createTask(
        data.title,
        data.due
      );


    case "create_event":

        return await createEvent(
            data.title,
            data.when,
            data.durationMinutes
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