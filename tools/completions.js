import supabase from "../lib/supabase.js";
import { DateTime } from "luxon";
import { getCompletedTasks, taskDueDate } from "./googleTasks.js";
import { findTaskByGoogleId } from "./database.js";
import { getUserTimezone } from "../lib/profile.js";
import { logActivity } from "./activityLog.js";
import { mapWithConcurrency } from "../lib/async.js";


// Nothing in this system recorded what the user actually DID — only what they
// planned. Every read tool answers "what's outstanding", and the moment a task
// was ticked off in the Google Tasks app it simply vanished from view, leaving
// no trace that it had ever been finished. Drift detection is impossible
// against that: you can't notice someone falling behind without knowing what
// keeping up looked like.
//
// This records completions as they happen, from Google's own completion
// timestamp rather than an inference about when the sync noticed. Two places,
// deliberately:
//   - tasks.status, so project tracking and the cascade see reality
//   - activity_logs, as an append-only behavioural stream that survives a task
//     row being edited or deleted later. That stream is what the accountability
//     work will eventually read.
//
// Most tasks live only in Google (6 of 8 at the time this was written, because
// anything created in the Tasks app never round-trips back), so a completion
// with no local row backfills one rather than being dropped.

const LOOKBACK_DAYS = 30;


export async function syncTaskCompletions({ lookbackDays = LOOKBACK_DAYS } = {}) {

  const tz = await getUserTimezone();

  const sinceISO = DateTime.now().minus({ days: lookbackDays }).toUTC().toISO();

  const completed = await getCompletedTasks({ sinceISO });


  let recorded = 0;
  let alreadyKnown = 0;
  let backfilled = 0;
  const errors = [];


  await mapWithConcurrency(completed, async (task) => {

    try {

      const existing = await findTaskByGoogleId(task.id);


      if (existing?.status === "completed") {
        alreadyKnown++;
        return;
      }


      const completedAt = task.completed;

      const due = task.due ? taskDueDate(task.due) : null;


      if (existing) {

        const { error } = await supabase
          .from("tasks")
          .update({ status: "completed", updated_at: completedAt })
          .eq("id", existing.id);

        if (error) throw new Error(error.message);

      } else {

        // Created in the Tasks app and never seen here. Record it so the
        // history is complete rather than silently partial.
        const { error } = await supabase
          .from("tasks")
          .insert([{
            title: task.title,
            status: "completed",
            due_date: due ? due.toISO() : null,
            google_task_id: task.id,
            updated_at: completedAt
          }]);

        if (error) throw new Error(error.message);

        backfilled++;

      }


      // How late or early it was finished is the actual signal — a task done
      // three weeks past its date is a different fact from one done early.
      const daysLate = due
        ? Math.round(DateTime.fromISO(completedAt).setZone(tz).startOf("day")
            .diff(due.startOf("day"), "days").days)
        : null;

      await logActivity({
        action: "task_completed",
        input: task.title,
        output: {
          google_task_id: task.id,
          completed_at: completedAt,
          due_date: due ? due.toISODate() : null,
          days_late: daysLate
        },
        success: true,
        source: "completion_sync"
      });

      recorded++;

    } catch (error) {

      errors.push({ task: task.title, error: error.message });

    }

  });


  return {

    success: true,

    message: `${recorded} newly recorded completion${recorded === 1 ? "" : "s"}, ${alreadyKnown} already known.`,

    data: { recorded, alreadyKnown, backfilled, scanned: completed.length, errors }

  };

}
