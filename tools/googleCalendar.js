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
  // This will eventually come from Supabase.
  const userTimeZone = "America/Los_Angeles";


  console.log("=== GOOGLE CALENDAR V6 ===");

  console.log({
    title,
    when,
    durationMinutes,
    userTimeZone
  });



  const parsedDate = chrono.parseDate(
    when,
    new Date(),
    {
      forwardDate: true
    }
  );


  if (!parsedDate) {
    throw new Error(
      `Could not understand date/time: ${when}`
    );
  }



  const start = DateTime.fromJSDate(
    parsedDate,
    {
      zone: userTimeZone
    }
  );


  const end = start.plus({
    minutes: durationMinutes
  });



  console.log("Parsed event:");

  console.log({

    start: start.toISO(),

    end: end.toISO(),

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