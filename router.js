import { createTask } from "./tools/googleTasks.js";
import { createEvent } from "./tools/googleCalendar.js";

export async function executeTool(data) {

  switch(data.tool) {

    case "create_task":

      return await createTask(
        data.title,
        data.due
      );


    case "create_event":

      return await createEvent(
        data.title,
        data.date,
        data.time,
        data.durationMinutes
      );


    default:

      return {
        success:false,
        message:"Unknown tool."
      };
  }
}