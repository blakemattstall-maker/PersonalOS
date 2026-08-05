// One-off generator for web/public/voice-samples/*.mp3 — the static preview
// clips the settings panel plays instead of hitting /api/tts on every tap.
//
// Run manually whenever NEURAL_VOICES or VOICE_PREVIEW_TEXT changes:
//   OPENAI_API_KEY=... node scripts/generateVoiceSamples.mjs
//
// Not part of the build — these files are meant to be stable and committed,
// not regenerated on every deploy (that would silently reintroduce the exact
// cost/latency this exists to avoid).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VOICES = ["sage", "alloy", "ash", "coral", "nova", "onyx", "echo", "fable", "shimmer"];

const TEXT =
  "Here's where things stand. You have three tasks due today and one of them " +
  "is already late. Nothing on the calendar until two.";

const OUT_DIR = path.join(__dirname, "..", "public", "voice-samples");

const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error("Set OPENAI_API_KEY before running this.");
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const voice of VOICES) {

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: TEXT,
      response_format: "mp3",
      instructions:
        "Read this as a calm, clear personal assistant briefing someone who is " +
        "walking. Natural pacing, real sentence rhythm, no announcer energy, no " +
        "excitement. Pause properly at full stops."
    })
  });

  if (!res.ok) {
    console.error(`FAILED ${voice}:`, res.status, await res.text());
    continue;
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  fs.writeFileSync(path.join(OUT_DIR, `${voice}.mp3`), buffer);

  console.log(`${voice}.mp3 — ${buffer.length} bytes`);

}
