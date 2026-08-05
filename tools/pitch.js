import { toFile } from "openai";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";


// Skill-challenge half of the Practice tab. Record a pitch, get it
// transcribed, get real feedback — filler words, contradictions, structure —
// instead of just hoping it sounded fine.

const PRIMARY_MODEL = "gpt-4o-transcribe";
const FALLBACK_MODEL = "whisper-1";


async function transcribe(audioBuffer, mimeType) {

  const ext = mimeType?.includes("mp4") ? "mp4" : mimeType?.includes("wav") ? "wav" : "webm";

  const file = await toFile(audioBuffer, `pitch.${ext}`, { type: mimeType || "audio/webm" });

  try {

    const result = await openai.audio.transcriptions.create({
      file,
      model: PRIMARY_MODEL
    });

    return { text: result.text, model: PRIMARY_MODEL };

  } catch (error) {

    if (error.status !== 400 && error.status !== 404) throw error;

    const result = await openai.audio.transcriptions.create({
      file,
      model: FALLBACK_MODEL
    });

    return { text: result.text, model: FALLBACK_MODEL };

  }

}


function countFillers(text) {

  const fillers = ["um", "uh", "like", "you know", "sort of", "kind of", "basically", "actually", "literally"];

  const lower = text.toLowerCase();

  const counts = {};

  for (const f of fillers) {
    // Word-boundary match so "actually" doesn't also match inside a longer
    // word, and "like" as a filler isn't distinguished from "like" as a verb
    // here — that distinction is left to the model's read of the transcript,
    // this count is a rough signal alongside it, not the final word.
    const matches = lower.match(new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "g"));
    if (matches?.length) counts[f] = matches.length;
  }

  return counts;

}


async function analyze(transcriptText, topic, fillerCounts) {

  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Analyze this spoken pitch. Be blunt and specific — the user
has explicitly said he wants direct feedback, not encouragement for its own
sake, and the goal is he actually gets better at delivering this.

${topic ? `What the pitch is about: ${topic}` : ""}

Rough filler-word count already measured in code (use as a data point, don't
re-count from scratch): ${JSON.stringify(fillerCounts)}

Transcript:
"${transcriptText}"

Return ONLY JSON:
{
  "overall": "1-2 sentences, direct verdict on the delivery",
  "clarity": "how clear and well-structured the core message was",
  "filler_word_note": "a specific, blunt read on the filler count above — is it actually a problem at this length or not",
  "contradictions": ["a specific place where two statements didn't square with each other, quoting both, if any"],
  "strongest_moment": "the single strongest sentence or moment, quoted",
  "one_thing_to_work_on": "the single highest-leverage thing to improve next time"
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


export async function submitPitch({ audio_base64, mime_type, topic }) {

  if (!audio_base64) {
    throw new Error("submitPitch requires audio_base64.");
  }

  const audioBuffer = Buffer.from(audio_base64, "base64");

  // Vercel's serverless functions (not this project's Next.js app, the raw
  // api/[resource].js one) cap the request body at 4.5MB on Hobby, with no
  // way to raise it — a bigger recording gets rejected by the platform before
  // this code even runs, so the cap has to sit well under that once base64's
  // ~33% inflation and the surrounding JSON are accounted for. 2MB decoded is
  // still several minutes of compressed speech, far more than one pitch.
  if (audioBuffer.length > 2 * 1024 * 1024) {
    throw new Error("Recording is too long for one upload — keep it under a couple of minutes.");
  }

  const { text, model } = await transcribe(audioBuffer, mime_type);

  if (!text || text.trim().length < 5) {
    throw new Error("Couldn't make out any speech in that recording — try again somewhere quieter.");
  }

  const fillerCounts = countFillers(text);

  const feedback = await analyze(text, topic, fillerCounts);

  feedback.filler_counts = fillerCounts;

  const { data: session, error } = await supabase
    .from("practice_sessions")
    .insert([{
      type: "pitch",
      topic: topic || null,
      transcript: [{ role: "user", message: text }],
      feedback,
      status: "completed",
      completed_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) throw new Error(error.message);

  return { success: true, session_id: session.id, transcript: text, feedback, transcriptionModel: model };

}
