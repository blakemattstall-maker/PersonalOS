import { getGoogleClient } from "../lib/google.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";
import { createCalendarEventRecord, updateCalendarGoogleId, findRecentDuplicateEvent, getEventById, updateEventTimesRecord, syncEventByGoogleId, deleteEventRowByGoogleId } from "../tools/database.js";
import { buildRecurrenceRule, resolveColor } from "../lib/recurrence.js";
import { classifyEvent } from "../lib/eventKind.js";


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

  const colorId = resolveColor(color);
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