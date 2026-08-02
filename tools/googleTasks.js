import { google } from "googleapis";
import { getGoogleClient } from "../lib/google";
import * as chrono from "chrono-node";

export async function createTask(title, dueText) {

  const auth = await getGoogleClient();

  const tasks = google.tasks({
    version: "v1",
    auth
  });

  let due;

  if (dueText) {
    const parsed = chrono.parseDate(dueText);

    if (parsed) {
      due = parsed.toISOString();
    }
  }

  console.log({
    title,
    due
  });

  const response = await tasks.tasks.insert({
    tasklist: "@default",
    requestBody: {
      title,
      due
    }
  });

  return {
  success: true,
  message: `Created task "${title}"`,
  data: response.data
};
}