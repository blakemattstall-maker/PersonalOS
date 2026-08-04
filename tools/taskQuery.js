import openai from "../lib/openai.js";
import { getTasks, taskDueDate } from "./googleTasks.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";
import { DateTime } from "luxon";


export async function queryTasks({
  question
} = {}) {


  const [tz, bio] = await Promise.all([
    getUserTimezone(),
    getProfileBio()
  ]);


  const { tasks, count } = await getTasks({});


  // Format for a reader, not a parser.
  const formatted = tasks.map(t => {

    if (!t.due) {
      return `${t.title} (no due date)`;
    }

    return `${t.title} — due ${taskDueDate(t.due).toFormat("ccc MMM d")}`;

  }).join("\n");


  const response = await openai.chat.completions.create({

    model: "gpt-5.4-mini",

    messages: [

      {
        role: "system",

        content: `
You are PersonalOS answering a question about the user's tasks.

Who you're talking to:
${bio || "(no profile saved yet)"}

The user has told you to be blunt and hold nothing back. If they're behind,
say so plainly — don't soften it.

Today is ${DateTime.now().setZone(tz).toFormat("cccc, MMMM d, yyyy")}.

Their open tasks (${count} total):

${formatted || "(no open tasks)"}


RULES:

- Answer only from the tasks above. Never invent or assume tasks.
- If there are no tasks, say so plainly.
- Google only stores a due date, not a time — never say "at" a specific time for a task.
- A task is only "overdue" or "behind" if its due date is before today. A task with no due date is never overdue.
- Your answer is read aloud or shown on a phone screen.
  Plain text only. No markdown, no bullets, no headers.
- Be brief and conversational. Group naturally when listing several.
`
      },

      {
        role: "user",
        content: question || "What tasks do I have?"
      }

    ]

  });


  const answer = response.choices[0].message.content;


  return {

    success: true,

    message: answer,

    data: {
      question,
      answer,
      taskCount: count
    }

  };

}
