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

import { DEMO_SESSION } from "../../../lib/demo.js";
import { rateLimit } from "../../../lib/ratelimit.js";


// Who is asking for speech. This route answered 200 to a request carrying no
// cookie and no key until 2026-08-10 — anyone on the internet could spend
// OpenAI tokens on the project's bill. It is a browser-fetched route (the
// proxy deliberately excludes /api), so it does its own session check rather
// than inheriting one.
//
// The owner's passphrase check is guarded the same way the proxy's is: an
// unset SITE_PASSPHRASE must not make `undefined === undefined` pass.
function sessionOf(request) {

  const cookie = request.headers.get("cookie") || "";

  const match = cookie.match(/(?:^|;\s*)pos_session=([^;]*)/);

  const value = match ? decodeURIComponent(match[1]) : null;

  if (process.env.SITE_PASSPHRASE && value === process.env.SITE_PASSPHRASE) return "owner";

  // The Shortcut path: no cookie jar, but it holds the API secret.
  if (process.env.API_SECRET && request.headers.get("x-pos-key") === process.env.API_SECRET) return "owner";

  if (value === DEMO_SESSION) return "demo";

  return null;

}


function callerIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "local";
}


// Per-minute ceilings, per caller address. The owner's is sized so real use
// (a brief and a few nudges read aloud) never touches it; the demo's is sized
// so a curious visitor hears the feature and a script gets bored. Demo text
// is also capped — the fixture brief is ~600 characters, so 2,600 covers
// every legitimate demo read while refusing a pasted novel.
const OWNER_TTS_PER_MINUTE = 30;
const DEMO_TTS_PER_MINUTE = 8;
const DEMO_TEXT_LIMIT = 2600;

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


async function synthesize({ input, voice, speed, model, format = "mp3" }) {

  const body = {
    model,
    voice,
    input,
    response_format: format,
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

  const session = sessionOf(request);

  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = session === "demo" ? DEMO_TTS_PER_MINUTE : OWNER_TTS_PER_MINUTE;

  const allowed = rateLimit(`tts:${session}:${callerIp(request)}`, limit);

  if (!allowed.ok) {
    return Response.json(
      { error: "Too many requests — slow down.", retryAfter: allowed.retryAfter },
      { status: 429, headers: { "Retry-After": String(allowed.retryAfter) } }
    );
  }

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

  if (session === "demo" && text.length > DEMO_TEXT_LIMIT) {
    return Response.json({ error: "That's longer than the demo will read." }, { status: 413 });
  }

  const voice = VOICES.has(payload?.voice) ? payload.voice : "sage";

  // The API accepts 0.25–4.0. Anything outside a narrow band around normal is
  // unintelligible for a long brief, so it is clamped rather than trusted.
  const speed = Math.min(1.6, Math.max(0.7, Number(payload?.speed) || 1));

  // WAV exists for the desk device. A microcontroller can pipe raw PCM
  // straight to its speaker, and forcing it to decode MP3 would mean a whole
  // decoder library on 512KB of RAM for no listener benefit. Browsers keep
  // getting MP3 — it is a tenth the bytes over the network.
  const format = payload?.format === "wav" ? "wav" : "mp3";

  const parts = chunk(text);

  let model = PRIMARY_MODEL;

  try {

    const buffers = [];

    for (const part of parts) {

      try {

        buffers.push(await synthesize({ input: part, voice, speed, model, format }));

      } catch (error) {

        // Only worth retrying once, on the first chunk: if the newer model
        // isn't available to this account it will fail identically every time.
        if (model === PRIMARY_MODEL && (error.status === 400 || error.status === 404)) {
          model = FALLBACK_MODEL;
          buffers.push(await synthesize({ input: part, voice, speed, model, format }));
        } else {
          throw error;
        }

      }

    }

    // MP3 frames are self-describing, so concatenating separately-generated
    // files plays as one continuous track without a container rewrite. WAV is
    // not: every chunk after the first must lose its 44-byte RIFF header or
    // the headers play as clicks. Same PCM format throughout (one voice, one
    // sample rate), so headerless concatenation is valid — and the device
    // scans for the "data" marker rather than trusting offset 44 anyway.
    const audio = format === "wav" && buffers.length > 1
      ? Buffer.concat(buffers.map((b, i) => (i === 0 ? b : b.subarray(44))))
      : Buffer.concat(buffers);

    return new Response(audio, {
      headers: {
        "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
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
