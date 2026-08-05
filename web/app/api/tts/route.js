// Server-side speech, because the device cannot do this job.
//
// iOS does not expose downloaded Enhanced or Premium voices to the Web Speech
// API. A page asking `speechSynthesis.getVoices()` on an iPhone gets the small
// built-in set — including the novelty ones (Bubbles, Cellos, Organ) — no
// matter what has been downloaded in Settings. There is no flag or permission
// that changes this; it is a WebKit boundary. So the only way to get a voice
// worth listening to for a five-minute brief is to synthesize it server-side
// and hand the browser an audio file.
//
// It lives in the web project rather than the API backend so the audio doesn't
// take two network hops, and because this is a presentation concern.
//
// Cost: roughly $0.015 per minute of speech. A 1,500-character brief is about
// 90 seconds, so daily use is well under $1/month.

export const maxDuration = 60;

// The API rejects longer input, and long text is exactly the case this exists
// for, so it is split rather than truncated.
const CHUNK_LIMIT = 3800;

// gpt-4o-mini-tts takes an `instructions` field for delivery. tts-1 does not
// and is the fallback if the newer model is unavailable on the account.
const PRIMARY_MODEL = "gpt-4o-mini-tts";
const FALLBACK_MODEL = "tts-1";

const VOICES = new Set([
  "alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"
]);

const DEFAULT_INSTRUCTIONS =
  "Read this as a calm, clear personal assistant briefing someone who is " +
  "walking. Natural pacing, real sentence rhythm, no announcer energy, no " +
  "excitement. Pause properly at full stops.";


// Split on sentence boundaries so a chunk never breaks mid-word — the seam
// between two audio files is audible, and it is far less noticeable at a full
// stop than in the middle of a clause.
function chunk(text) {

  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) || [text];

  const out = [];
  let current = "";

  for (const sentence of sentences) {

    if (current.length + sentence.length > CHUNK_LIMIT && current) {
      out.push(current);
      current = "";
    }

    // A single sentence longer than the limit is pathological but possible
    // (a pasted wall of text with no punctuation). Hard-split it.
    if (sentence.length > CHUNK_LIMIT) {
      for (let i = 0; i < sentence.length; i += CHUNK_LIMIT) {
        out.push(sentence.slice(i, i + CHUNK_LIMIT));
      }
      continue;
    }

    current += sentence;

  }

  if (current) out.push(current);

  return out;

}


async function synthesize({ input, voice, speed, model }) {

  const body = {
    model,
    voice,
    input,
    response_format: "mp3",
    speed
  };

  if (model === PRIMARY_MODEL) body.instructions = DEFAULT_INSTRUCTIONS;

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(`OpenAI TTS ${res.status}: ${detail.slice(0, 300)}`);
    error.status = res.status;
    throw error;
  }

  return Buffer.from(await res.arrayBuffer());

}


export async function POST(request) {

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "No OPENAI_API_KEY configured on the web project." }, { status: 501 });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const text = (payload?.text || "").trim();

  if (!text) {
    return Response.json({ error: "Nothing to read." }, { status: 400 });
  }

  const voice = VOICES.has(payload?.voice) ? payload.voice : "sage";

  // The API accepts 0.25–4.0. Anything outside a narrow band around normal is
  // unintelligible for a long brief, so it is clamped rather than trusted.
  const speed = Math.min(1.6, Math.max(0.7, Number(payload?.speed) || 1));

  const parts = chunk(text);

  let model = PRIMARY_MODEL;

  try {

    const buffers = [];

    for (const part of parts) {

      try {

        buffers.push(await synthesize({ input: part, voice, speed, model }));

      } catch (error) {

        // Only worth retrying once, on the first chunk: if the newer model
        // isn't available to this account it will fail identically every time.
        if (model === PRIMARY_MODEL && (error.status === 400 || error.status === 404)) {
          model = FALLBACK_MODEL;
          buffers.push(await synthesize({ input: part, voice, speed, model }));
        } else {
          throw error;
        }

      }

    }

    // MP3 frames are self-describing, so concatenating separately-generated
    // files plays as one continuous track without a container rewrite.
    const audio = Buffer.concat(buffers);

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "private, max-age=3600",
        "X-TTS-Model": model,
        "X-TTS-Chunks": String(parts.length)
      }
    });

  } catch (error) {

    console.error("TTS FAILED:", error.message);

    return Response.json({ error: error.message }, { status: 502 });

  }

}
