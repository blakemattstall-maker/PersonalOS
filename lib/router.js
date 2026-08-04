import { createTask } from "../tools/googleTasks.js";
import { createEvent } from "../tools/googleCalendar.js";
import { saveMemory } from "../tools/memory.js";
import { logActivity } from "../tools/activityLog.js";
import { answerQuestion } from "../tools/answer.js";
import { querySchedule } from "../tools/schedule.js";
import { queryTasks } from "../tools/taskQuery.js";
import { saveNote, queryNotes } from "../tools/notes.js";
import { startDeepThinking } from "../tools/deepThinking.js";
import { logBodyweight } from "../tools/bodyweight.js";
import { syncCanvasAssignments } from "../tools/canvas.js";
import { saveIntention } from "../tools/intentions.js";
import { queryProjects } from "../tools/projects.js";


// Logging must never mask a real error.
// If Supabase is down, we still want the original failure to surface.
async function safeLog(entry) {

  try {
    await logActivity(entry);
  } catch (logError) {
    console.error("ACTIVITY LOG FAILED:", logError.message);
  }

}


export async function executeTool(data, originalText = null) {

  console.log("Router received:");
  console.log(data);


  const startedAt = Date.now();

  let result;


  try {

    switch(data.tool) {


      case "create_task":

        result = await createTask({
          title: data.title,
          year: data.year,
          month: data.month,
          day: data.day,
          hour: data.hour,
          minute: data.minute,
          timezone: data.timezone
        });

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



      case "general_question":

        result = await answerQuestion({
          question: originalText || data.question
        });

        break;

    
        case "query_schedule":

        result = await querySchedule({
          startDate: data.startDate,
          endDate: data.endDate,
          question: originalText || data.question
        });

        break;



      case "query_tasks":

        result = await queryTasks({
          question: originalText || data.question
        });

        break;



      case "save_note":

        result = await saveNote({
          content: data.content
        });

        break;



      case "query_notes":

        result = await queryNotes({
          question: originalText || data.question
        });

        break;



      case "start_deep_thinking":

        result = await startDeepThinking({
          topic: data.topic
        });

        break;



      case "log_bodyweight":

        result = await logBodyweight({
          weight: data.weight,
          unit: data.unit
        });

        break;



      case "sync_canvas":

        result = await syncCanvasAssignments();

        break;



      case "save_intention":

        result = await saveIntention({
          content: data.content
        });

        break;



      case "query_projects":

        result = await queryProjects({
          question: originalText || data.question
        });

        break;



      default:

        throw new Error(
          `Unknown tool: ${data.tool}`
        );

    }


    await safeLog({
      action: data.tool,
      input: JSON.stringify(data),
      output: result,
      success: true,
      source: "shortcut",
      duration_ms: Date.now() - startedAt
    });


    return result;


  } catch (error) {


    await safeLog({
      action: data.tool || "unknown",
      input: JSON.stringify(data),
      output: null,
      success: false,
      source: "shortcut",
      duration_ms: Date.now() - startedAt,
      error_message: error.message
    });


    throw error;


  }

}