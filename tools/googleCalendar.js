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

  const parsedStart = chrono.parseDate(
    `${date} ${time}`,
    new Date(),
    {
      forwardDate: true
    }
  );

  if (!parsedStart) {
    throw new Error("Could not understand event date/time");
  }

  const end = new Date(
    parsedStart.getTime() + durationMinutes * 60000
  );

  console.log({
    title,
    start: parsedStart,
    end
  });

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      start: {
        dateTime: parsedStart.toISOString(),
        timeZone: "America/Los_Angeles"
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "America/Los_Angeles"
      }
    }
  });

  return {
    success: true,
    message: `Created event "${title}"`,
    data: response.data
  };
}