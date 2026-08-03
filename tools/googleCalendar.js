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
  // Later this will come from Supabase user profile.
  const userTimeZone = "America/Los_Angeles";


  console.log("=== GOOGLE CALENDAR V7 ===");

  console.log({
    title,
    when,
    durationMinutes,
    userTimeZone
  });


  const now = DateTime
    .now()
    .setZone(userTimeZone)
    .toJSDate();


  const parsed = chrono.parse(
    when,
    now,
    {
      forwardDate: true
    }
  );


  console.log("Chrono raw:");
  console.log(parsed);


  if (!parsed.length) {
    throw new Error(
      `Could not understand date/time: ${when}`
    );
  }


  const result = parsed[0];


  const year = result.start.get("year");
  const month = result.start.get("month");
  const day = result.start.get("day");

  const hour = result.start.get("hour") ?? 9;
  const minute = result.start.get("minute") ?? 0;


  console.log("Chrono fields:");

  console.log({
    year,
    month,
    day,
    hour,
    minute
  });


  const start = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour,
      minute
    },
    {
      zone: userTimeZone
    }
  );


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