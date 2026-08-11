import { getGoogleClient } from "../lib/google.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import { createCalendarEventRecord, updateCalendarGoogleId, findRecentDuplicateEvent, getEventById, updateEventTimesRecord, syncEventByGoogleId, deleteEventRowByGoogleId } from "../tools/database.js";
import { buildRecurrenceRule, resolveColor } from "../lib/recurrence.js";
import { classifyEvent, KIND_COLOR } from "../lib/eventKind.js";
import { getSettings } from "../lib/settings.js";


export async function createEvent({
  title,
  year,
  month,
  day,
  hour,
  minute,
  timezone = null,
  durationMinutes = 60,
  goal_id = null,
  project_id = null,
  person_id = null,
  // Everything PersonalOS creates is Tomato unless asked otherwise, so it can
  // be picked out at a glance from events that came from anywhere else.
  color = null,
  // A word from RECURRENCE_PATTERNS ("weekly", "yearly", …), not a raw RRULE —
  // see lib/recurrence.js for why the model is not allowed to write the rule.
  recurrence = null,
  recurrenceCount = null
}) {


  const tz = timezone || await getUserTimezone();


  const start = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour,
      minute
    },
    {
      zone: tz
    }
  );


  if (!start.isValid) {
    throw new Error(
      `Invalid calendar date: ${start.invalidReason}`
    );
  }


  const end = start.plus({
    minutes: durationMinutes
  });

  const duplicate = await findRecentDuplicateEvent({
    title,
    start_time: start.toISO()
  });


  if (duplicate) {

    console.log("DUPLICATE BLOCKED:", title);

    return {
      success: true,
      duplicate: true,
      message: `Event "${title}" was already created moments ago.`,
      data: null,
      supabase_id: duplicate.id
    };

  }

  // An explicit colour always wins — the model only sets `color` when the user
  // actually asked for one, and a direct request outranks a guess from
  // classifyEvent. Otherwise, when the setting is on, the event is coloured by
  // what kind of thing it is rather than a flat default, so a glance at the
  // calendar already sorts meetings from focus blocks from reminders.
  let colorId;

  if (color) {

    colorId = resolveColor(color);

  } else {

    const { auto_color_events, event_colors } = await getSettings();

    if (auto_color_events) {

      const kind = classifyEvent({ title, start: start.toISO(), end: end.toISO() });

      // A saved override wins over the shipped default for that kind, and the
      // shipped default covers every kind with no override. Stored per kind
      // rather than as a whole map so that adding a new kind here does not
      // need anyone to re-save their settings to pick up a colour for it.
      colorId = resolveColor(event_colors?.[kind] || KIND_COLOR[kind]);

    } else {

      colorId = resolveColor(null);

    }

  }

  const rrule = buildRecurrenceRule(recurrence, start, { count: recurrenceCount });

  const supabaseRecord = await createCalendarEventRecord({
    title,
    start_time: start.toISO(),
    end_time: end.toISO(),
    timezone: tz,
    goal_id,
    project_id,
    person_id,
    color_id: colorId,
    recurrence: rrule
  });


  const { auth, google } = await getGoogleClient();

  const calendar = google.calendar({
    version: "v3",
    auth
  });


  const requestBody = {

    summary: title,

    colorId,

    start: {
      dateTime: start.toISO(),
      timeZone: tz
    },

    end: {
      dateTime: end.toISO(),
      timeZone: tz
    },

    // Omitted entirely when there's no rule — Google rejects an empty array.
    ...(rrule ? { recurrence: [rrule] } : {})

  };


  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody
  });


  await updateCalendarGoogleId(
    supabaseRecord.id,
    response.data.id
  );


  return {
    success: true,
    message: `Created event "${title}"${rrule ? `, repeating ${recurrence}` : ""}`,
    data: response.data,
    supabase_id: supabaseRecord.id
  };

}


// An all-day, yearly-recurring event on a fixed month/day — for birthdays and
// anniversaries.
//
// A birthday was a TASK because Google Tasks cannot recur (v1 has no recurrence
// field), so recurrence had to be re-materialised by a daily job. A calendar
// event has no such limit: one event with RRULE:FREQ=YEARLY appears every year
// forever with nothing to renew, which is both simpler and what an important
// date actually is — a marker on the calendar, not a to-do.
//
// Idempotent through a caller-supplied deterministic id. A second insert of the
// same id comes back 409, and what happens then is the caller's choice:
//   update:false — leave it (the daily healer, which must NEVER resurrect an
//                  event the owner deleted on purpose).
//   update:true  — patch it to the current date/title (an explicit re-save).
export async function upsertYearlyAllDayEvent({ eventId, title, month, day, tz = null, notes = null, update = false }) {

  const zone = tz || await getUserTimezone();

  const now = DateTime.now().setZone(zone);

  // Anchor on this year's occurrence; the recurrence covers every year after.
  // Feb 29 in a non-leap year is invalid and simply skipped — the same
  // deliberate gap the task path had.
  const start = DateTime.fromObject({ year: now.year, month, day }, { zone });

  if (!start.isValid) return { success: false, skipped: `invalid date ${month}/${day}` };

  const body = {
    summary: title,
    ...(notes ? { description: notes } : {}),
    // All-day events carry a `date`, never a `dateTime`, and the end date is
    // EXCLUSIVE — the day after.
    start: { date: start.toFormat("yyyy-MM-dd") },
    end: { date: start.plus({ days: 1 }).toFormat("yyyy-MM-dd") },
    recurrence: ["RRULE:FREQ=YEARLY"],
    // A birthday shouldn't paint you busy all day.
    transparency: "transparent",
    // A heads-up the afternoon before, rather than silence or a wall of default
    // reminders.
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 600 }] }
  };

  const { auth, google } = await getGoogleClient();

  const calendar = google.calendar({ version: "v3", auth });

  try {

    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: { id: eventId, ...body }
    });

    return { success: true, created: true, id: res.data.id };

  } catch (error) {

    const code = error.code || error?.response?.status;

    if (code !== 409) throw error;

    // Already there. The healer leaves it alone; an explicit save patches it.
    if (!update) return { success: true, existed: true, id: eventId };

    await calendar.events.patch({ calendarId: "primary", eventId, requestBody: body });

    return { success: true, updated: true, id: eventId };

  }

}


export async function getEvents({
  startDate,
  endDate,
  timezone = null,
  maxResults = 50
}) {


  const tz = timezone || await getUserTimezone();


  const timeMin = DateTime
    .fromISO(startDate, { zone: tz })
    .startOf("day");

  const timeMax = DateTime
    .fromISO(endDate, { zone: tz })
    .endOf("day");


  if (!timeMin.isValid || !timeMax.isValid) {
    throw new Error(
      `Invalid date range: ${startDate} to ${endDate}`
    );
  }


  const { auth, google } = await getGoogleClient();

  const calendar = google.calendar({
    version: "v3",
    auth
  });


  const response = await calendar.events.list({

    calendarId: "primary",

    timeMin: timeMin.toISO(),
    timeMax: timeMax.toISO(),

    maxResults,

    // Expands recurring events into actual occurrences
    singleEvents: true,

    orderBy: "startTime"

  });


  // Slim the payload down before it ever reaches the AI.
  //
  // attendeeCount is what makes "meeting" distinguishable from "an hour I set
  // aside", and it was being thrown away here — so every consumer saw four
  // identical "events" and had no way to tell a call with other people from a
  // solo work block. classifyEvent decides the kind from these fields in code
  // rather than leaving a model to guess at it.
  const events = (response.data.items || []).map(event => {

    const slim = {

      id: event.id,

      title: event.summary || "(no title)",

      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,

      allDay: !event.start?.dateTime,

      location: event.location || null,

      attendeeCount: (event.attendees || []).length,

      // Who else is expected, for a brief that can say "with Jon" rather than
      // "a meeting". Names only — never addresses.
      attendees: (event.attendees || [])
        .filter(a => !a.self)
        .map(a => a.displayName || (a.email || "").split("@")[0])
        .filter(Boolean)
        .slice(0, 5),

      hasNotes: Boolean(event.description)

    };

    return { ...slim, kind: classifyEvent(slim) };

  });


  return {

    success: true,

    count: events.length,

    range: {
      startDate,
      endDate,
      timezone: tz
    },

    events

  };

}



export async function updateEventTimes({
  supabase_id,
  newStartISO,
  newEndISO
}) {

  const eventRow = await getEventById(supabase_id);

  const tz = eventRow.timezone || await getUserTimezone();


  if (eventRow.google_event_id) {

    const { auth, google } = await getGoogleClient();

    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.patch({
      calendarId: "primary",
      eventId: eventRow.google_event_id,
      requestBody: {
        start: { dateTime: newStartISO, timeZone: tz },
        end: { dateTime: newEndISO, timeZone: tz }
      }
    });

  }


  await updateEventTimesRecord(supabase_id, newStartISO, newEndISO);

  return { success: true };

}



// --- Modifications keyed off the Google id (see googleTasks.js for why) ---

export async function rescheduleEventByGoogleId({
  google_event_id,
  year,
  month,
  day,
  hour,
  minute,
  durationMinutes = null,
  timezone = null
}) {

  const tz = timezone || await getUserTimezone();

  const { auth, google } = await getGoogleClient();

  const calendar = google.calendar({ version: "v3", auth });


  // Read the existing event first so a move that doesn't mention a length
  // keeps the one it already had, rather than silently becoming an hour.
  const { data: existing } = await calendar.events.get({
    calendarId: "primary",
    eventId: google_event_id
  });

  const previousStart = existing.start?.dateTime ? DateTime.fromISO(existing.start.dateTime) : null;
  const previousEnd = existing.end?.dateTime ? DateTime.fromISO(existing.end.dateTime) : null;

  const existingMinutes = previousStart && previousEnd
    ? previousEnd.diff(previousStart, "minutes").minutes
    : 60;


  // Time omitted ("move it to Thursday") keeps the original time of day.
  const start = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: hour ?? previousStart?.setZone(tz).hour ?? 9,
      minute: minute ?? previousStart?.setZone(tz).minute ?? 0
    },
    { zone: tz }
  );

  if (!start.isValid) {
    throw new Error(`Invalid calendar date: ${start.invalidReason}`);
  }

  const end = start.plus({ minutes: durationMinutes || existingMinutes });


  await calendar.events.patch({
    calendarId: "primary",
    eventId: google_event_id,
    requestBody: {
      start: { dateTime: start.toISO(), timeZone: tz },
      end: { dateTime: end.toISO(), timeZone: tz }
    }
  });


  await syncEventByGoogleId(google_event_id, {
    start_time: start.toISO(),
    end_time: end.toISO()
  });


  return { start, end };

}



export async function deleteEventByGoogleId(google_event_id) {

  await deleteGoogleEvent(google_event_id);

  await deleteEventRowByGoogleId(google_event_id);

}



export async function deleteGoogleEvent(google_event_id) {

  if (!google_event_id) return;

  const { auth, google } = await getGoogleClient();

  const calendar = google.calendar({ version: "v3", auth });

  try {
    await calendar.events.delete({ calendarId: "primary", eventId: google_event_id });
  } catch (error) {
    // Already gone on Google's side is fine — not a failure.
    if (!String(error.message).includes("404") && !String(error.message).includes("410")) throw error;
  }

}