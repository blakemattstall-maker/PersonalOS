import openai from "../lib/openai.js";
import { getTasks, taskDueDate } from "./googleTasks.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";
import { DateTime } from "luxon";
import { MODELS } from "../lib/models.js";


export async function queryTasks({
  question
} = {}) {


  const [tz, bio] = await Promise.all([
    getUserTimezone(),
    getProfileBio()
  ]);


  const { tasks, count } = await getTasks({});


  // Classify here rather than asking the model to compare dates. Left to it,
  // it kept opening with "yes, you're behind on X" and then correcting itself
  // mid-sentence that X is actually due today — the comparison is exact work,
  // so the model should only be writing prose about a decision already made.
  // Compare calendar dates as strings, not instants. A Google due date is
  // UTC midnight and "today" is local midnight, so comparing the two directly
  // makes anything due today look seven hours overdue — the same date-vs-
  // timestamp confusion that made every due date display a day early.
  const todayKey = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");

  const buckets = { overdue: [], today: [], upcoming: [], undated: [] };

  for (const t of tasks) {

    if (!t.due) {
      buckets.undated.push(t.title);
      continue;
    }

    const due = taskDueDate(t.due);
    const dueKey = due.toFormat("yyyy-MM-dd");

    const label = `${t.title} (${due.toFormat("ccc MMM d")})`;

    if (dueKey < todayKey) buckets.overdue.push(label);
    else if (dueKey === todayKey) buckets.today.push(t.title);
    else buckets.upcoming.push(label);

  }


  const section = (title, items) =>
    items.length ? `${title}:\n${items.map(i => `  ${i}`).join("\n")}` : null;

  const formatted = [
    section("GENUINELY BEHIND — past their due date", buckets.overdue),
    section("DUE TODAY — not behind", buckets.today),
    section("UPCOMING — not behind", buckets.upcoming),
    section("NO DUE DATE — never behind", buckets.undated)
  ].filter(Boolean).join("\n\n");


  const response = await openai.chat.completions.create({

    model: MODELS.EXTRACT,

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
- The groupings above are already decided — trust them completely and never re-derive them. Only tasks under GENUINELY BEHIND count as behind or overdue. If that group is absent or empty, the honest answer to "am I behind" is no, followed by what's due today or coming up.
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
