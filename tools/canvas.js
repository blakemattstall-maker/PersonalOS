import ical from "node-ical";
import { DateTime } from "luxon";
import { getUserTimezone } from "../lib/profile.js";
import { createTask } from "./googleTasks.js";
import { findTaskByCanvasId } from "./database.js";


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
      url: event.url || null
    }));

}


export async function syncCanvasAssignments() {

  const assignments = await getUpcomingCanvasAssignments();

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const assignment of assignments) {

    try {

      const existing = await findTaskByCanvasId({ canvas_assignment_id: assignment.canvas_id });

      if (existing) {
        skipped++;
        continue;
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

  }

  return {

    success: true,

    message: `Synced ${created} new assignment${created === 1 ? "" : "s"}, ${skipped} already up to date.`,

    data: { created, skipped, errors }

  };

}
