import { createTask } from "../tools/tasks.js";
import { createEvent } from "../tools/calendar.js";

export async function executeTool(intent) {

  switch(intent.intent) {

    case "create_task":
      return await createTask(intent);

    case "create_event":
      return await createEvent(intent);

    default:
      return {
        success: false,
        message: "No matching tool"
      };
  }
}