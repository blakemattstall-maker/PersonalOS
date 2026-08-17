import ical from "node-ical";
import { DateTime } from "luxon";
import { getUserTimezone } from "../lib/profile.js";
import { createTask } from "./googleTasks.js";
import { findTaskByCanvasId, deleteTaskRowById } from "./database.js";
import { mapWithConcurrency } from "../lib/async.js";
import { logActivity } from "./activityLog.js";


export async function getUpcomingCanvasAssignments({ daysAhead = 21 } = {}) {

  const feedUrl = process.env.CANVAS_ICS_URL;

  if (!feedUrl) {
    throw new Error("Canvas is not configured (missing CANVAS_ICS_URL).");
  }

  const tz = await getUserTimezone();

  const now = DateTime.now().setZone(tz);
  const windowEnd = now.plus({ days: daysAhead });

  const events = await ical.async.fromURL(feedUrl);

  return Object.values(events)
    .filter(event => event.type === "VEVENT" && event.start)
    .filter(event => {
      const start = DateTime.fromJSDate(event.start).setZone(tz);
      return start >= now.startOf("day") && start <= windowEnd;
    })
    .map(event => ({
      canvas_id: `canvas_${event.uid}`,
      title: event.summary || "Untitled assignment",
      due_at: DateTime.fromJSDate(event.start).setZone(tz),
      // node-ical hands URL back as { params, val } whenever the property
      // carries parameters, and Canvas emits `URL;VALUE=URI:` on every
      // assignment — so this was an object riding into Google Tasks' string
      // `notes` field, and every insert 400'd ("Starting an object on a
      // scalar field"). Silently: the sync caught each error, the mirror row
      // had already been written, and the next run skipped the "synced" task.
      // Only 2 of 42 assignments ever actually reached Google.
      url: typeof event.url === "object" && event.url !== null
        ? event.url.val || null
        : event.url || null
    }));

}


export async function syncCanvasAssignments() {

  // A semester, not a fortnight. The window was 21 days, which held exactly
  // until the fall syllabi landed: 42 assignments arrived at once and 33 of
  // them — every homework, exam and project due past early September — were
  // silently out of range, which from the calendar's side reads as "the sync
  // stopped working". Every assignment carries a due date and the task list
  // only surfaces by date, so a far-future exam costs nothing until it is
  // close — but its absence costs trust immediately.
  const assignments = await getUpcomingCanvasAssignments({ daysAhead: 180 });

  let created = 0;
  let skipped = 0;
  let repaired = 0;
  const errors = [];

  // Each assignment carries its own canvas_id, so these don't interact —
  // safe to run a few at a time. Sequentially this blew Vercel's limit the
  // moment a semester's worth of assignments landed at once.
  await mapWithConcurrency(assignments, async (assignment) => {

    try {

      const existing = await findTaskByCanvasId({ canvas_assignment_id: assignment.canvas_id });

      // Synced means it reached Google, not that a row exists. createTask
      // writes its Supabase mirror BEFORE the Google insert, so a failed
      // insert (three weeks of them, via the notes bug above) leaves a row
      // that made every later run report "already up to date" about a task
      // no calendar has ever shown. A row with no google_task_id is that
      // residue: clear it and recreate through the full path, rather than
      // teaching this loop to finish half a create.
      if (existing?.google_task_id) {
        skipped++;
        return;
      }

      if (existing) {
        await deleteTaskRowById(existing.id);
        repaired++;
      }

      const due = assignment.due_at;

      await createTask({
        title: assignment.title,
        year: due.year,
        month: due.month,
        day: due.day,
        hour: due.hour,
        minute: due.minute,
        canvas_assignment_id: assignment.canvas_id,
        notes: assignment.url
      });

      created++;

    } catch (error) {

      errors.push({ assignment: assignment.title, error: error.message });

    }

  });

  // The run leaves a durable record either way. On Aug 15 the Google token was
  // dead, every createTask threw, and the cron still reported success with the
  // failures folded into a payload nobody stores — a zero-created morning was
  // indistinguishable from a quiet feed. success here means "nothing errored",
  // and diagnostics reads this row to say when the sync last actually ran.
  const uniqueErrors = [...new Set(errors.map(e => e.error))];

  await logActivity({
    action: "canvas_sync",
    input: null,
    output: { created, skipped, repaired, feed: assignments.length, errors: uniqueErrors.slice(0, 3) },
    success: errors.length === 0,
    source: "cron"
  }).catch(error => console.error("CANVAS SYNC LOG FAILED:", error?.message));

  return {

    success: true,

    message: `Synced ${created} new assignment${created === 1 ? "" : "s"}`
      + (repaired ? ` (${repaired} of them repaired half-creates)` : "")
      + `, ${skipped} already up to date.`,

    data: { created, skipped, repaired, errors }

  };

}
