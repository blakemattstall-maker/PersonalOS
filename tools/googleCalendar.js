import { google } from "googleapis";
import { getGoogleClient } from "../lib/google.js";
import { DateTime } from "luxon";


export async function createEvent({
  title,
  year,
  month,
  day,
  hour,
  minute,
  timezone = "America/Los_Angeles",
  durationMinutes = 60
}) {


  console.log("=== GOOGLE CALENDAR V9 ===");

  console.log({
    title,
    year,
    month,
    day,
    hour,
    minute,
    timezone,
    durationMinutes
  });


  const auth = await getGoogleClient();


  const calendar = google.calendar({
    version: "v3",
    auth
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
      zone: timezone
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


  console.log("FINAL TIMES");

  console.log({
    start: start.toISO(),
    end: end.toISO(),
    timezone
  });


  const requestBody = {

    summary: title,

    start: {
      dateTime: start.toISO(),
      timeZone: timezone
    },

    end: {
      dateTime: end.toISO(),
      timeZone: timezone
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

    success:true,

    message:`Created event "${title}"`,

    data:response.data

  };

}