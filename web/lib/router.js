import { createTask } from "../tools/googleTasks.js";
import { createEvent } from "../tools/googleCalendar.js";
import { saveMemory } from "../tools/memory.js";
import { logActivity } from "../tools/activityLog.js";
import { answerQuestion } from "../tools/answer.js";
import { queryConnections } from "../tools/connections.js";
import { querySchedule } from "../tools/schedule.js";
import { queryTasks } from "../tools/taskQuery.js";
import { saveNote, queryNotes } from "../tools/notes.js";
import { startDeepThinking } from "../tools/deepThinking.js";
import { logBodyweight } from "../tools/bodyweight.js";
import { answerHealthQuestion } from "../tools/health.js";
import { syncCanvasAssignments } from "../tools/canvas.js";
import { saveIntention } from "../tools/intentions.js";
import { queryProjects } from "../tools/projects.js";
import { modifyTask, modifyEvent } from "../tools/modify.js";
import { queryFinances } from "../tools/finances.js";
import { researchQuery } from "../tools/research.js";
import { savePerson, queryPeople, recordContact } from "../tools/people.js";
import { draftEmail, reviewInbox } from "../tools/gmail.js";
import { exportToDoc } from "../tools/googleDocs.js";
import { answerDiningQuestion, planMeals, logMeal, updateDiningPrefs } from "../tools/mealPlan.js";


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
          timezone: data.timezone,
          recurrence: data.recurrence ?? null,
          recurrenceCount: data.recurrenceCount ?? null
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
          durationMinutes: data.durationMinutes,
          recurrence: data.recurrence ?? null,
          recurrenceCount: data.recurrenceCount ?? null,
          color: data.color ?? null
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



      case "query_connections":

        result = await queryConnections({
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



      case "query_health":

        result = await answerHealthQuestion({
          question: originalText || data.question
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



      case "query_finances":

        result = await queryFinances({
          question: data.question || originalText,
          days: data.days
        });

        break;



      case "modify_task":

        result = await modifyTask({
          description: data.description,
          action: data.action,
          year: data.year,
          month: data.month,
          day: data.day
        });

        break;



      case "modify_event":

        result = await modifyEvent({
          description: data.description,
          action: data.action,
          year: data.year,
          month: data.month,
          day: data.day,
          hour: data.hour,
          minute: data.minute,
          durationMinutes: data.durationMinutes
        });

        break;



      case "query_projects":

        result = await queryProjects({
          question: originalText || data.question
        });

        break;



      case "research_query":

        result = await researchQuery({
          query: originalText || data.query
        });

        break;



      case "save_person":

        result = await savePerson({
          name: data.name,
          relationship: data.relationship ?? null,
          notes: data.notes ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          check_in_days: data.check_in_days ?? null,
          important_date_month: data.important_date_month ?? null,
          important_date_day: data.important_date_day ?? null,
          important_date_label: data.important_date_label ?? null
        });

        break;



      case "log_work": {
        const { logWork } = await import("../tools/workLog.js");
        result = await logWork({
          org: data.org,
          content: data.content,
          occurred_at: data.occurred_at ?? null
        });
        break;
      }


      case "query_work": {
        const { answerWorkQuestion } = await import("../tools/workLog.js");
        result = await answerWorkQuestion({
          question: originalText || data.question,
          org: data.org ?? null
        });
        break;
      }


      case "query_people":

        result = await queryPeople({
          question: originalText || data.question
        });

        break;



      case "log_contact":

        result = await recordContact({
          name: data.name
        });

        break;



      case "review_inbox":

        result = await reviewInbox({
          days: data.days ?? 7,
          question: data.question ?? null
        });

        break;


      case "draft_email":

        result = await draftEmail({
          about: data.about,
          to: data.to ?? null,
          tone: data.tone ?? null
        });

        break;



      case "export_to_doc":

        result = await exportToDoc({
          request: data.request,
          title: data.title ?? null,
          research: data.research === true
        });

        break;



      case "open_on_laptop": {

        const { pushLaptopCommand } = await import("./laptopQueue.js");

        const SITES = {
          gmail: "https://mail.google.com/mail/u/0/",
          docs: "https://docs.google.com/document/u/0/",
          calendar: "https://calendar.google.com/calendar/u/0/",
          drive: "https://drive.google.com/drive/u/0/"
        };

        // One command, one kind. Apps and files are handled entirely by the
        // helper on the laptop — file names and search hits never leave the
        // machine; only the spoken words travel.
        let command = null;
        let spoken = null;

        if (data.app) {
          command = { kind: "app", app: data.app, label: data.app };
          spoken = `Opening ${data.app} on your laptop.`;
        } else if (data.file) {
          command = { kind: "file", query: data.file, app: data.app || null, label: data.file };
          spoken = `Looking for ${data.file} on your laptop.`;
        } else {
          const url = data.url && /^https?:\/\//.test(data.url) ? data.url
            : data.site && SITES[data.site] ? SITES[data.site]
            : data.search ? `https://www.google.com/search?q=${encodeURIComponent(data.search)}`
            : null;
          if (url) {
            command = { kind: "url", url, label: data.search || data.site || "link" };
            spoken = "Opening on your laptop.";
          }
        }

        if (!command) {
          result = { success: false, message: "I wasn't sure what to open on the laptop." };
          break;
        }

        const { pushed, online } = await pushLaptopCommand(command);

        result = {
          success: pushed,
          message: !pushed ? "That didn't look like something I can open."
            : online ? spoken
            : "Queued for your laptop — the helper doesn't look like it's running.",
          data: { ...command }
        };

        break;

      }



      case "query_dining":

        result = await answerDiningQuestion({
          question: data.question || originalText,
          date: data.date ?? null
        });

        break;



      case "plan_meals":

        result = await planMeals({
          date: data.date ?? null,
          meals: data.meals ?? null,
          note: data.note ?? null
        });

        break;



      case "log_meal":

        result = await logMeal({
          description: data.description || originalText,
          meal: data.meal ?? null,
          date: data.date ?? null
        });

        break;



      case "set_food_preference":

        result = await updateDiningPrefs({
          dislike: data.dislike ?? null,
          like: data.like ?? null,
          remove: data.remove ?? null,
          calorie_target: data.calorie_target ?? null,
          protein_target: data.protein_target ?? null,
          meal: data.meal ?? null,
          window_start: data.window_start ?? null,
          window_end: data.window_end ?? null
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