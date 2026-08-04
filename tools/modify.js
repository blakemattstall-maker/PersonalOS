import openai from "../lib/openai.js";
import { DateTime } from "luxon";
import { getUserTimezone } from "../lib/profile.js";
import { getTasks, completeTaskByGoogleId, rescheduleTaskByGoogleId, deleteTaskByGoogleId, taskDueDate } from "./googleTasks.js";
import { getEvents, rescheduleEventByGoogleId, deleteEventByGoogleId } from "./googleCalendar.js";
import { savePendingClarification } from "./pending.js";


// The system could create things but never change them. The functions to
// modify already existed, but every one of them took a Supabase id — and most
// items only exist in Google (6 of 8 open tasks had no local row), so nothing
// the user actually says was reachable. These tools work from the user's own
// words instead: find the item live in Google, then act on it.
//
// Resolution is a small model call rather than string matching, because people
// say "the dentist thing", "my 3pm", "that essay" — none of which survive a
// substring match. Ambiguity is never guessed through: two plausible matches
// means asking, not picking, because these operations change real commitments.


async function resolveTarget({ description, candidates, kind }) {

  if (candidates.length === 0) {
    return { status: "none" };
  }

  const list = candidates
    .map((c, i) => `${i}: ${c.label}`)
    .join("\n");


  const response = await openai.chat.completions.create({

    model: "gpt-5.4-mini",

    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content: `The user wants to act on one of their ${kind}s and referred to it as: "${description}"

Their ${kind}s:
${list}

Pick the one they meant. People are loose and abbreviate — "the dentist thing", "my 3pm", "that essay" — so match on meaning, not wording.

Return ONLY JSON:
{ "index": <number, or null if nothing plausibly matches>,
  "alternatives": [<indices of any OTHER entries a reasonable person might have meant, empty if the match is clear>] }

"alternatives" is for genuine coin-flips only — two entries so alike that picking either could be wrong. If the user's wording singles one out, that is NOT ambiguous: "draft the deck" clearly means the draft one even when a review one exists, and "my 3pm" clearly means the 3pm one. Return an empty list unless you would genuinely have to guess.`
      }
    ]

  });


  let parsed;

  try {
    parsed = JSON.parse(response.choices[0].message.content);
  } catch (error) {
    return { status: "none" };
  }


  const index = parsed.index;

  if (index == null || !candidates[index]) {
    return { status: "none" };
  }


  const alternatives = (parsed.alternatives || [])
    .filter(i => i !== index && candidates[i]);


  if (alternatives.length > 0) {
    return {
      status: "ambiguous",
      options: [candidates[index], ...alternatives.map(i => candidates[i])]
    };
  }


  return { status: "ok", target: candidates[index] };

}



export async function modifyTask({ description, action, year, month, day, _noFallback = false }) {

  if (!description || !action) {
    throw new Error("modifyTask requires a description and an action.");
  }

  const tz = await getUserTimezone();

  const { tasks } = await getTasks({});


  const candidates = tasks.map(t => ({
    id: t.id,
    title: t.title || "(untitled)",
    label: `${t.title || "(untitled)"}${t.due ? ` — due ${taskDueDate(t.due).toFormat("ccc MMM d")}` : " — no due date"}`
  }));


  const resolved = await resolveTarget({ description, candidates, kind: "task" });


  // "Push the coffee chat prep to 7pm" — is that a task or an event? The user
  // usually doesn't think in those terms and the router has to guess, so a
  // miss here falls through to the calendar rather than failing. Completion
  // has no event equivalent, so it doesn't fall through.
  if (resolved.status === "none" && !_noFallback && action !== "complete") {

    const viaCalendar = await modifyEvent({
      description, action, year, month, day, _noFallback: true
    });

    if (viaCalendar.success || viaCalendar.needsClarification) {
      return viaCalendar;
    }

  }


  if (resolved.status === "none") {
    return {
      success: false,
      message: `I couldn't find a task matching "${description}". You have ${candidates.length} open: ${candidates.slice(0, 5).map(c => c.title).join(", ")}.`
    };
  }

  if (resolved.status === "ambiguous") {

    const question = `Two of those match — ${resolved.options.map(o => o.label).join(", and ")}. Which one?`;

    await savePendingClarification({
      kind: "task",
      action,
      args: { year, month, day },
      candidates: resolved.options,
      question
    });

    return {
      success: false,
      needsClarification: true,
      message: question,
      data: { options: resolved.options }
    };

  }


  return performTaskAction(resolved.target, action, { year, month, day });

}



async function performTaskAction(target, action, { year, month, day } = {}) {

  if (action === "complete") {

    await completeTaskByGoogleId(target.id);

    return { success: true, message: `Marked "${target.title}" done.`, data: { id: target.id } };

  }


  if (action === "delete") {

    await deleteTaskByGoogleId(target.id);

    return { success: true, message: `Deleted "${target.title}".`, data: { id: target.id } };

  }


  if (action === "reschedule") {

    if (!year || !month || !day) {
      return { success: false, message: `I need a date to move "${target.title}" to.` };
    }

    const due = await rescheduleTaskByGoogleId({ google_task_id: target.id, year, month, day });

    return {
      success: true,
      message: `Moved "${target.title}" to ${due.toFormat("cccc, MMMM d")}.`,
      data: { id: target.id }
    };

  }


  return { success: false, message: `I don't know how to "${action}" a task.` };

}



export async function modifyEvent({ description, action, year, month, day, hour, minute, durationMinutes, _noFallback = false }) {

  if (!description || !action) {
    throw new Error("modifyEvent requires a description and an action.");
  }

  const tz = await getUserTimezone();

  const now = DateTime.now().setZone(tz);


  // maxResults defaults to 50, and recurring events are expanded into one
  // entry per occurrence — a daily standup alone is 90 of them. A wide window
  // at the default silently truncated the list before reaching the event the
  // user actually meant, so an event two days away reported as "not found".
  // Narrower window, and a ceiling high enough that truncation isn't the
  // thing deciding whether this works.
  const { events } = await getEvents({
    startDate: now.minus({ days: 7 }).toFormat("yyyy-MM-dd"),
    endDate: now.plus({ days: 60 }).toFormat("yyyy-MM-dd"),
    timezone: tz,
    maxResults: 250
  });


  const candidates = events.map(e => ({
    id: e.id,
    title: e.title,
    label: e.allDay
      ? `${e.title} — ${DateTime.fromISO(e.start).setZone(tz).toFormat("ccc MMM d")} (all day)`
      : `${e.title} — ${DateTime.fromISO(e.start).setZone(tz).toFormat("ccc MMM d, h:mm a")}`
  }));


  const resolved = await resolveTarget({ description, candidates, kind: "calendar event" });


  // Mirror of the fallback in modifyTask — the router's task/event guess
  // shouldn't decide whether the request works.
  if (resolved.status === "none" && !_noFallback) {

    const viaTasks = await modifyTask({
      description, action, year, month, day, _noFallback: true
    });

    if (viaTasks.success || viaTasks.needsClarification) {
      return viaTasks;
    }

  }


  if (resolved.status === "none") {
    return {
      success: false,
      message: `I couldn't find anything matching "${description}" on your calendar or in your tasks.`
    };
  }

  if (resolved.status === "ambiguous") {

    const question = `Two of those match — ${resolved.options.map(o => o.label).join(", and ")}. Which one?`;

    await savePendingClarification({
      kind: "event",
      action,
      args: { year, month, day, hour, minute, durationMinutes },
      candidates: resolved.options,
      question
    });

    return {
      success: false,
      needsClarification: true,
      message: question,
      data: { options: resolved.options }
    };

  }


  return performEventAction(resolved.target, action, { year, month, day, hour, minute, durationMinutes });

}



async function performEventAction(target, action, { year, month, day, hour, minute, durationMinutes } = {}) {

  if (action === "delete") {

    await deleteEventByGoogleId(target.id);

    return { success: true, message: `Deleted "${target.title}" from your calendar.`, data: { id: target.id } };

  }


  if (action === "reschedule") {

    if (!year || !month || !day) {
      return { success: false, message: `I need a date to move "${target.title}" to.` };
    }

    const { start } = await rescheduleEventByGoogleId({
      google_event_id: target.id,
      year,
      month,
      day,
      hour,
      minute,
      durationMinutes
    });

    return {
      success: true,
      message: `Moved "${target.title}" to ${start.toFormat("cccc, MMMM d 'at' h:mm a")}.`,
      data: { id: target.id }
    };

  }


  return { success: false, message: `I don't know how to "${action}" an event.` };

}



// Called before normal routing when a question is parked. The user's reply is
// matched against the candidates we already showed them, so "the draft one"
// resolves even though it means nothing on its own. Anything that doesn't
// clearly pick one is treated as a change of subject, not a bad answer.
export async function resumePendingClarification({ pending, text }) {

  const { kind, action, args, candidates } = pending.output || {};

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { handled: false };
  }

  const resolved = await resolveTarget({
    description: text,
    candidates,
    kind: kind === "event" ? "calendar event" : "task"
  });

  if (resolved.status !== "ok") {
    return { handled: false };
  }

  const result = kind === "event"
    ? await performEventAction(resolved.target, action, args || {})
    : await performTaskAction(resolved.target, action, args || {});

  return { handled: true, result };

}
