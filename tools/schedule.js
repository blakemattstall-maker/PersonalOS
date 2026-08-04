import openai from "../lib/openai.js";
import { getEvents } from "./googleCalendar.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";


export async function querySchedule({
  startDate,
  endDate,
  question
}) {


  if (!startDate || !endDate) {
    throw new Error("Schedule query requires a start and end date.");
  }


  const tz = await getUserTimezone();


  const { events, count } = await getEvents({
    startDate,
    endDate,
    timezone: tz
  });


  // Format for a reader, not a parser.
  // Raw ISO timestamps make the model worse at time reasoning.
  const formatted = events.map(e => {

    if (e.allDay) {
      return `${e.start} (all day) — ${e.title}`;
    }

    const start = DateTime.fromISO(e.start).setZone(tz);
    const end = DateTime.fromISO(e.end).setZone(tz);

    return `${start.toFormat("ccc MMM d, h:mm a")} to ${end.toFormat("h:mm a")} — ${e.title}`;

  }).join("\n");


  const response = await openai.chat.completions.create({

    model: "gpt-5.4-mini",

    messages: [

      {
        role: "system",

        content: `
You are PersonalOS answering a question about the user's schedule.

Today is ${DateTime.now().setZone(tz).toFormat("cccc, MMMM d, yyyy")}.

Their schedule from ${startDate} to ${endDate} (${count} events):

${formatted || "(no events in this range)"}


RULES:

- Answer only from the schedule above. Never invent or assume events.
- If there are no events in the range, say so plainly.
- Your answer is read aloud or shown on a phone screen.
  Plain text only. No markdown, no bullets, no headers.
- Be brief and conversational. Group by day when listing several.
- Say times naturally ("9am", "2:30pm"), never ISO timestamps.
`
      },

      {
        role: "user",
        content: question || "What's on my schedule?"
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
      eventCount: count,
      range: { startDate, endDate }
    }

  };

}