import { toFile } from "openai";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";


// Skill-challenge half of the Practice tab. Record a pitch, get it
// transcribed, get real feedback — filler words, contradictions, structure —
// instead of just hoping it sounded fine.

const PRIMARY_MODEL = "gpt-4o-transcribe";
const FALLBACK_MODEL = "whisper-1";


function missingColumn(error) {
  return ["42703", "PGRST204"].includes(error?.code)
    || /column .* does not exist/i.test(error?.message || "");
}


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


// Two rubrics, one engine.
//
// A pitch and an explainer are the same physical act — talk at a microphone for
// a minute — but they succeed for opposite reasons. A pitch is graded on
// persuasion: did you make me want this. An explainer is graded on
// understanding: do you actually know this, or are you reciting a definition
// you read four minutes ago. Grading an explainer on persuasiveness would
// reward exactly the confident hand-waving the exercise exists to expose,
// which is why the mode changes the rubric rather than just the prompt text.

const RUBRICS = {

  pitch: {

    frame: `Analyze this spoken pitch. Be blunt and specific — the user has
explicitly said he wants direct feedback, not encouragement for its own sake,
and the goal is he actually gets better at delivering this.`,

    schema: `{
  "overall": "1-2 sentences, direct verdict on the delivery",
  "clarity": "how clear and well-structured the core message was",
  "filler_word_note": "a specific, blunt read on the filler count above — is it actually a problem at this length or not",
  "contradictions": ["a specific place where two statements didn't square with each other, quoting both, if any"],
  "strongest_moment": "the single strongest sentence or moment, quoted",
  "one_thing_to_work_on": "the single highest-leverage thing to improve next time"
}`

  },

  explainer: {

    frame: `Analyze this spoken explanation. The user picked a concept, spent a
few minutes researching it, and is now teaching it back from memory as a
thought exercise. He wants to find out whether he actually understood it.

Grade UNDERSTANDING, not polish. The specific failure to catch is fluent
recitation — correct-sounding sentences assembled from a summary he skimmed,
with no working model underneath. The tells: a definition restated instead of
explained, an analogy that doesn't survive being pushed on, a confident claim
about a mechanism with no account of WHY it works that way, jargon used as a
substitute for the idea rather than a label for it.

Be blunt. If he understood it, say so plainly. If he got a fact wrong, correct
it outright — a wrong explanation left standing is worse than no practice.`,

    schema: `{
  "overall": "1-2 sentences: did he actually understand this, or recite it",
  "clarity": "whether someone who didn't know the concept would now get it",
  "filler_word_note": "a blunt read on the filler count above at this length",
  "accuracy_notes": ["anything he got factually wrong or misleadingly simplified, corrected — empty if he was accurate"],
  "depth_verdict": "did he explain the mechanism, or restate the definition — quote the line that shows which",
  "strongest_moment": "the single clearest moment of real understanding, quoted",
  "one_thing_to_work_on": "the single highest-leverage thing to improve next time"
}`

  }

};


async function analyze(transcriptText, topic, fillerCounts, mode = "pitch", prompt = null) {

  const rubric = RUBRICS[mode] || RUBRICS.pitch;

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `${rubric.frame}

${topic ? `The topic: ${topic}` : ""}
${prompt ? `The brief he was given: ${prompt}` : ""}

Rough filler-word count already measured in code (use as a data point, don't
re-count from scratch): ${JSON.stringify(fillerCounts)}

Transcript:
"${transcriptText}"

Return ONLY JSON:
${rubric.schema}

Omit items from an array (return empty) rather than padding it with something
weak just to fill it.`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


// Domains are picked in code, not by the model, because asking a model for "a
// random interesting concept" reliably returns the same handful of famous ones
// — Dunning-Kruger, the butterfly effect, Schrödinger's cat — which stops
// being practice by the third time. Seeding it with a randomly chosen domain
// and excluding what was recently used forces genuine spread.
const CONCEPT_DOMAINS = [
  "cognitive psychology and bias",
  "physics",
  "economics and game theory",
  "evolutionary biology",
  "statistics and probability",
  "philosophy of mind",
  "systems and complexity theory",
  "neuroscience",
  "information theory and computation",
  "logic and paradox",
  "chemistry and materials",
  "sociology and collective behaviour",
  "linguistics",
  "history of science",
  "ethics and moral philosophy",
  "geology and deep time"
];


async function recentTopics(limit = 15) {

  const { data } = await supabase
    .from("practice_sessions")
    .select("topic")
    .eq("type", "pitch")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data || []).map(r => r.topic).filter(Boolean);

}


export async function generatePitchTopic() {

  const domain = CONCEPT_DOMAINS[Math.floor(Math.random() * CONCEPT_DOMAINS.length)];

  const recent = await recentTopics().catch(() => []);

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Pick one concept from ${domain} for someone to research
briefly and then explain out loud, from memory, as a thought exercise.

The bar: interesting enough to be worth understanding, self-contained enough to
research in about five minutes, and deep enough that explaining it well is
genuinely harder than defining it. Something with a real mechanism underneath —
where a person who only skimmed a summary will visibly run out of road when
asked to say why it works.

Avoid anything so famous it's a cliché of this exercise unless you can point at
a specific, less-obvious angle on it.

${recent.length ? `He has recently done these — pick something clearly different:\n${recent.map(t => `- ${t}`).join("\n")}` : ""}

Also write a short brief: a specific framing that forces him to actually use
the idea rather than recite it. The good ones make him apply the concept to a
concrete situation, defend it to a particular skeptical listener, or explain
why the obvious intuition about it is wrong. One or two sentences.

Return ONLY JSON:
{
  "topic": "the concept, named plainly",
  "prompt": "the brief — what exactly to do with it in the recording",
  "why_interesting": "one sentence on what makes this worth understanding",
  "research_hint": "what specifically to look up in those five minutes"
}`
      }

    ]

  });

  const generated = JSON.parse(response.choices[0].message.content);

  return { success: true, ...generated, domain };

}


export async function submitPitch({ audio_base64, mime_type, topic, mode = "pitch", prompt = null }) {

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

  const resolvedMode = RUBRICS[mode] ? mode : "pitch";

  const feedback = await analyze(text, topic, fillerCounts, resolvedMode, prompt);

  feedback.filler_counts = fillerCounts;

  const row = {
    type: "pitch",
    topic: topic || null,
    transcript: [{ role: "user", message: text }],
    feedback,
    status: "completed",
    completed_at: new Date().toISOString()
  };

  // mode/prompt arrive with docs/schema-practice-split.sql. Before it runs,
  // PostgREST rejects the whole insert for containing columns it doesn't know
  // — so a pending migration would break recording entirely rather than just
  // losing the label. Attach them only when they carry something, and fall
  // back to the columns that have always existed if the insert is refused.
  if (resolvedMode !== "pitch") row.mode = resolvedMode;
  if (prompt) row.prompt = prompt;

  let session;

  const { data, error } = await supabase
    .from("practice_sessions")
    .insert([row])
    .select()
    .single();

  if (error && missingColumn(error)) {

    const { mode: _m, prompt: _p, ...legacy } = row;

    const retry = await supabase
      .from("practice_sessions")
      .insert([legacy])
      .select()
      .single();

    if (retry.error) throw new Error(retry.error.message);

    session = retry.data;

  } else if (error) {

    throw new Error(error.message);

  } else {

    session = data;

  }

  return {
    success: true,
    session_id: session.id,
    transcript: text,
    feedback,
    mode: resolvedMode,
    transcriptionModel: model
  };

}
