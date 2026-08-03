import { google } from "googleapis";
import { getGoogleClient } from "../lib/google";
import { DateTime } from "luxon";


export async function createTask({
  title,
  year,
  month,
  day,
  hour = 9,
  minute = 0,
  timezone = "America/Los_Angeles"
}) {


  const auth = await getGoogleClient();


  const tasks = google.tasks({
    version: "v1",
    auth
  });


  let due;


  if (
    year &&
    month &&
    day
  ) {

    const date = DateTime.fromObject(
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


    if (!date.isValid) {
      throw new Error(
        `Invalid task date: ${date.invalidReason}`
      );
    }


    due = date.toUTC().toISO();

  }


  console.log("TASK CREATE");

  console.log({
    title,
    due,
    timezone
  });


  const response = await tasks.tasks.insert({

    tasklist: "@default",

    requestBody: {
      title,
      ...(due && { due })
    }

  });


  return {

    success: true,

    message: `Created task "${title}"`,

    data: response.data

  };

}