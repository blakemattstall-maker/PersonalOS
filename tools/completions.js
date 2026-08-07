import supabase from "../lib/supabase.js";
import { DateTime } from "luxon";
import { getCompletedTasks, taskDueDate } from "./googleTasks.js";
import { getGoogleClient } from "../lib/google.js";
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


// Google is the source of truth for tasks and events, but only completions ever
// travelled back. Deleting a task in the Tasks app removed it from Google and
// left the mirror row here untouched, forever — so the dashboard kept counting
// work that no longer existed, and the divergence only ever grew.
//
// This is deliberately paranoid, because its failure mode is deleting real
// rows. Two guards, both load-bearing:
//
//   1. An empty result from Google is treated as an API failure, never as
//      "he deleted everything." A transient blip must not wipe the table.
//   2. If more than half the mirrored rows look missing at once, it stops and
//      reports instead of acting. A truncated or partial listing looks exactly
//      like a mass deletion, and the difference matters far too much to guess.
//
// Rows are removed rather than flagged, matching the intent of a deletion, but
// each one is written to activity_logs first — that stream is append-only and
// survives the row, which is what makes this safe to be destructive about.
const MAX_SAFE_DELETION_RATIO = 0.5;


async function allGoogleTaskIds() {

  const { auth, google } = await getGoogleClient();

  const tasksApi = google.tasks({ version: "v1", auth });

  const ids = new Set();

  let pageToken;

  do {

    const response = await tasksApi.tasks.list({
      tasklist: "@default",
      maxResults: 100,
      // Everything Google still holds, in any state. A task the user deleted is
      // absent from this; a completed or hidden one is not.
      showCompleted: true,
      showHidden: true,
      showDeleted: false,
      ...(pageToken && { pageToken })
    });

    for (const task of response.data.items || []) ids.add(task.id);

    pageToken = response.data.nextPageToken;

  } while (pageToken);

  return ids;

}


export async function reconcileDeletedTasks() {

  const live = await allGoogleTaskIds();

  const { data: candidates, error } = await supabase
    .from("tasks")
    .select("id, title, google_task_id, status, project_id")
    .not("google_task_id", "is", null);

  if (error) throw new Error(error.message);

  if (!candidates || candidates.length === 0) {
    return { success: true, removed: 0, message: "Nothing mirrored from Google yet." };
  }


  // Archived projects are exempt, and this is the whole reason the exemption
  // exists rather than being an optimisation.
  //
  // Archiving a project deliberately does NOT touch Google — it only flips a
  // status column, and the dashboard promises "nothing is deleted, restore one
  // anytime". But putting a project away is exactly when someone also clears
  // its leftovers out of the Tasks app, so an archived project's tasks are
  // *expected* to be absent from Google. Reconciling them would delete the
  // contents of every archived project and make that promise false, while
  // looking from the outside like the sync was simply working.
  //
  // Caught by the ratio guard below on live data before it could do this: 12 of
  // 14 apparently-missing tasks belonged to one archived project.
  const { data: projects } = await supabase.from("projects").select("id, status");

  const archived = new Set(
    (projects || []).filter(p => p.status !== "active").map(p => p.id)
  );

  const exempt = candidates.filter(t => t.project_id && archived.has(t.project_id));

  const mirrored = candidates.filter(t => !(t.project_id && archived.has(t.project_id)));

  if (mirrored.length === 0) {
    return {
      success: true,
      removed: 0,
      exempt: exempt.length,
      message: "Everything mirrored belongs to an archived project — left alone."
    };
  }

  // Guard 1 — see above.
  if (live.size === 0) {
    return {
      success: false,
      removed: 0,
      message: `Google returned no tasks at all while ${mirrored.length} are mirrored here. ` +
               `Treating that as an API failure rather than a mass deletion, and doing nothing.`
    };
  }

  const missing = mirrored.filter(t => !live.has(t.google_task_id));

  if (missing.length === 0) {
    return { success: true, removed: 0, message: "Already in sync with Google." };
  }

  // Guard 2 — see above.
  const ratio = missing.length / mirrored.length;

  if (ratio > MAX_SAFE_DELETION_RATIO) {
    return {
      success: false,
      removed: 0,
      wouldHaveRemoved: missing.length,
      message: `${missing.length} of ${mirrored.length} mirrored tasks are absent from Google ` +
               `(${Math.round(ratio * 100)}%). That is more likely a partial listing than a real ` +
               `deletion, so nothing was removed. Re-run to confirm, or clear them by hand.`
    };
  }

  let removed = 0;

  const errors = [];

  await mapWithConcurrency(missing, async (task) => {

    try {

      // Written before the row goes, so the behavioural record outlives it.
      await logActivity({
        action: "task_deleted_in_google",
        input: task.title,
        output: { google_task_id: task.google_task_id, status_here: task.status },
        success: true,
        source: "deletion_sync"
      });

      const { error: delError } = await supabase.from("tasks").delete().eq("id", task.id);

      if (delError) throw new Error(delError.message);

      removed += 1;

    } catch (error) {
      errors.push({ task: task.title, error: error.message });
    }

  });

  return {
    success: true,
    removed,
    exempt: exempt.length,
    message: `${removed} task(s) deleted in Google are no longer tracked here` +
             `${exempt.length ? `; ${exempt.length} left alone as archived-project history` : ""}.`,
    ...(errors.length > 0 ? { errors } : {})
  };

}


// Calendar gets the opposite technique on purpose. Listing events expands
// recurring ones per occurrence and truncates at maxResults, so an absence in a
// listing is not evidence of deletion — that is trap #2 in the handoff doc, and
// acting on it would delete real events. Asking about each event by id gives a
// definitive 404/410 instead of an ambiguous silence, and the row count here is
// small enough that the extra calls cost nothing.
export async function reconcileDeletedEvents({ max = 200 } = {}) {

  const { data: mirrored, error } = await supabase
    .from("calendar_events")
    .select("id, title, google_event_id")
    .not("google_event_id", "is", null)
    .limit(max);

  if (error) throw new Error(error.message);

  if (!mirrored || mirrored.length === 0) {
    return { success: true, removed: 0, message: "Nothing mirrored from Google yet." };
  }

  const { auth, google } = await getGoogleClient();

  const calendar = google.calendar({ version: "v3", auth });

  const gone = [];
  const errors = [];

  await mapWithConcurrency(mirrored, async (event) => {

    try {

      const { data } = await calendar.events.get({
        calendarId: "primary",
        eventId: event.google_event_id
      });

      // Google keeps cancelled events retrievable rather than 404ing them, so
      // the status field is the real answer for anything deleted recently.
      if (data?.status === "cancelled") gone.push(event);

    } catch (error) {

      const code = error?.code ?? error?.response?.status;

      if (code === 404 || code === 410) gone.push(event);
      else errors.push({ event: event.title, error: error.message });

    }

  }, 4);

  if (gone.length === 0) {
    return { success: true, removed: 0, message: "Already in sync with Google.", ...(errors.length ? { errors } : {}) };
  }

  let removed = 0;

  for (const event of gone) {

    await logActivity({
      action: "event_deleted_in_google",
      input: event.title,
      output: { google_event_id: event.google_event_id },
      success: true,
      source: "deletion_sync"
    });

    const { error: delError } = await supabase.from("calendar_events").delete().eq("id", event.id);

    if (delError) errors.push({ event: event.title, error: delError.message });
    else removed += 1;

  }

  return {
    success: true,
    removed,
    message: `${removed} event(s) deleted in Google are no longer tracked here.`,
    ...(errors.length > 0 ? { errors } : {})
  };

}


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
