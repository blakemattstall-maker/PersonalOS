import { DateTime } from "luxon";
import { getUserTimezone } from "../lib/profile.js";
import { createTask } from "./googleTasks.js";
import { findTaskByCanvasId } from "./database.js";


async function fetchPlannerItems({ startDate, endDate }) {

  const baseUrl = process.env.CANVAS_BASE_URL;
  const token = process.env.CANVAS_ACCESS_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Canvas is not configured (missing CANVAS_BASE_URL or CANVAS_ACCESS_TOKEN).");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/planner/items?start_date=${startDate}&end_date=${endDate}&per_page=50`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Canvas API error: ${response.status} ${await response.text()}`);
  }

  return response.json();

}


export async function getUpcomingCanvasAssignments({ daysAhead = 21 } = {}) {

  const tz = await getUserTimezone();

  const now = DateTime.now().setZone(tz);
  const startDate = now.toISO();
  const endDate = now.plus({ days: daysAhead }).toISO();

  const items = await fetchPlannerItems({ startDate, endDate });

  return items
    .filter(item => item.plannable_type === "assignment" && item.plannable?.due_at)
    .map(item => ({
      canvas_id: `canvas_${item.plannable_id}`,
      title: item.plannable.title || item.plannable.name || "Untitled assignment",
      due_at: item.plannable.due_at,
      course: item.context_name || null
    }));

}


export async function syncCanvasAssignments() {

  const tz = await getUserTimezone();

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

      const due = DateTime.fromISO(assignment.due_at).setZone(tz);

      const title = assignment.course
        ? `${assignment.course}: ${assignment.title}`
        : assignment.title;

      await createTask({
        title,
        year: due.year,
        month: due.month,
        day: due.day,
        hour: due.hour,
        minute: due.minute,
        canvas_assignment_id: assignment.canvas_id
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
