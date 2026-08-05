import openai from "../lib/openai.js";
import { createNoteRecord, getRecentNotes } from "./database.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";
import { DateTime } from "luxon";
import { MODELS } from "../lib/models.js";


export async function saveNote({
  content
}) {


  if (!content) {
    throw new Error("A note requires content.");
  }


  const note = await createNoteRecord({ content });


  return {
    success: true,
    message: "Note saved.",
    data: note
  };

}



export async function queryNotes({
  question
} = {}) {


  const [tz, bio] = await Promise.all([
    getUserTimezone(),
    getProfileBio()
  ]);


  const notes = await getRecentNotes({ limit: 30 });


  // Format for a reader, not a parser.
  const formatted = notes.map(n => {

    const when = DateTime.fromISO(n.created_at).setZone(tz).toFormat("ccc MMM d");

    return `[${when}] ${n.content}`;

  }).join("\n");


  const response = await openai.chat.completions.create({

    model: MODELS.EXTRACT,

    messages: [

      {
        role: "system",

        content: `
You are PersonalOS answering a question using the user's saved notes.

Who you're talking to:
${bio || "(no profile saved yet)"}

Their ${notes.length} most recent notes:

${formatted || "(no notes saved yet)"}


RULES:

- Answer only from the notes above. Never invent or assume anything not written there.
- If nothing relevant is found, say so plainly.
- Your answer is read aloud or shown on a phone screen.
  Plain text only. No markdown, no bullets, no headers.
- Be brief and conversational.
`
      },

      {
        role: "user",
        content: question || "What have I written down recently?"
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
      noteCount: notes.length
    }

  };

}
