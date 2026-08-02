import { google } from "googleapis";
import { getGoogleClient } from "../lib/google.js";
import * as chrono from "chrono-node";

export async function createEvent(
  title,
  date,
  time,
  durationMinutes = 60
) {

  const auth = await getGoogleClient();

  const calendar = google.calendar({
    version: "v3",
    auth
  });

  const userTimeZone =
    "America/Chicago"; // temporary until user settings are added

  const parsed = chrono.parse(
    `${date} ${time}`,
    new Date(),
    {
      forwardDate: true
    }
  );

  if (!parsed.length) {
    throw new Error("Could not understand event date/time");
  }

  const start = parsed[0];

  const year = start.start.get("year");
  const month = start.start.get("month");
  const day = start.start.get("day");
  const hour = start.start.get("hour") ?? 9;
  const minute = start.start.get("minute") ?? 0;

  const parsedStart = new Date(
    year,
    month - 1,
    day,
    hour,
    minute
  );

  const end = new Date(
    parsedStart.getTime() + durationMinutes * 60000
  );

  console.log({
    title,
    chronoResult: start.text,
    parsedStart,
    local: parsedStart.toString()
  });


  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,

      start: {
        dateTime: parsedStart.toISOString(),
        timeZone: userTimeZone
      },

      end: {
        dateTime: end.toISOString(),
        timeZone: userTimeZone
      }
    }
  });


  return {
    success: true,
    message: `Created event "${title}"`,
    data: response.data
  };
}