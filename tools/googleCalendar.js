import { google } from "googleapis";
import { getGoogleClient } from "../lib/google.js";
import * as chrono from "chrono-node";
import { DateTime } from "luxon";


export async function createEvent(
  title,
  when,
  durationMinutes = 60
) {

  const auth = await getGoogleClient();

  const calendar = google.calendar({
    version: "v3",
    auth
  });


  // Temporary until user settings exist.
  // Later this should come from Supabase.
  const userTimeZone = "America/Los_Angeles";


  console.log("=== GOOGLE CALENDAR V8 ===");

  console.log({
    title,
    when,
    durationMinutes,
    userTimeZone
  });


  const nowLuxon = DateTime
    .now()
    .setZone(userTimeZone);

  const now = nowLuxon.toJSDate();


  console.log("REFERENCE TIME:");

  console.log({
    iso: nowLuxon.toISO(),
    weekday: nowLuxon.weekdayLong,
    zone: nowLuxon.zoneName
  });


  const parsedDate = chrono.parseDate(
    when,
    now,
    {
      forwardDate: true
    }
  );


  console.log("Chrono parsed:");

  console.log(parsedDate);


  if (!parsedDate) {
    throw new Error(
      `Could not understand date/time: ${when}`
    );
  }


  const start = DateTime
    .fromJSDate(parsedDate)
    .setZone(userTimeZone);


  const end = start.plus({
    minutes: durationMinutes
  });


  console.log("Luxon:");

  console.log({
    startISO: start.toISO(),
    endISO: end.toISO(),
    timezone: userTimeZone
  });


  const requestBody = {

    summary: title,

    start: {
      dateTime: start.toISO(),
      timeZone: userTimeZone
    },

    end: {
      dateTime: end.toISO(),
      timeZone: userTimeZone
    }

  };


  console.log("REQUEST BODY");

  console.log(
    JSON.stringify(requestBody, null, 2)
  );


  const response = await calendar.events.insert({

    calendarId: "primary",

    requestBody

  });


  return {

    success: true,

    message: `Created event "${title}"`,

    data: response.data

  };

}