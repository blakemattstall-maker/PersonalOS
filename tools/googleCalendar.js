import { google } from "googleapis";
import { getGoogleClient } from "../lib/google.js";
import * as chrono from "chrono-node";
import { DateTime } from "luxon";

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

  // TODO: Later, load this from the user's profile in Supabase.
  // For now, match your Google Calendar setting.
  const userTimeZone = "America/Los_Angeles";

  const input =
  date && time
    ? `${date} at ${time}`
    : date || time || "";

  console.log("=== GOOGLE CALENDAR V5 ===");
  console.log({
    title,
    input,
    durationMinutes,
    userTimeZone
  });

  const parsed = chrono.parse(
    input,
    new Date(),
    {
      forwardDate: true
    }
  );

  if (!parsed.length) {
    throw new Error("Could not understand event date/time");
  }

  const result = parsed[0];

  const year = result.start.get("year");
  const month = result.start.get("month");
  const day = result.start.get("day");
  const hour = result.start.get("hour") ?? 9;
  const minute = result.start.get("minute") ?? 0;

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

  console.log("Chrono fields:");
  console.log({
    year,
    month,
    day,
    hour,
    minute
  });

  console.log("Luxon:");
  console.log({
    startISO: start.toISO(),
    endISO: end.toISO()
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
  console.log(JSON.stringify(requestBody, null, 2));

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