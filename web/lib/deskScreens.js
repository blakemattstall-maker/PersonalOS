import supabase from "./supabase.js";
import openai from "./openai.js";
import { MODELS } from "./models.js";


// Screens the device did not know it could show.
//
// The desk display started as one fixed layout: clock, timeline, next event,
// nudge. That is a good resting face and a poor answer — asked "is my cut
// working and can I afford it", a fixed dashboard can only shrug, because
// nobody laid out a weight-and-spending screen in advance.
//
// So the model composes the screen. Not as code — a model emitting JSX would
// be a rendering engine one hallucinated CSS property away from a blank
// panel, and it would be arbitrary code from a language model painted onto a
// device in someone's room. Instead it fills a fixed vocabulary of blocks,
// below. Every field is clamped, every colour comes from the palette, and an
// unknown block kind is dropped rather than guessed at. The model gets to
// decide WHAT to show and in WHAT ORDER; it never gets to decide what a
// pixel is.
//
// The spec is stashed in app_settings under one key, which is why this needs
// no new table: the device's existing screen fetch reads it, renders it, and
// stops rendering it the moment it expires — so "go back to the clock"
// requires no command, no state on the device, and no way to get stuck.


const KEY = "desk_screen";

// Long enough to read an answer and glance back at it; short enough that a
// question asked and wandered away from does not leave the desk showing
// yesterday's macros. Two and a half minutes turned out to be far too long
// in practice — an answer you have finished reading is clutter, and the way
// back is a tap now, so this only has to cover "I looked away for a moment".
const TTL_SECONDS = 75;

// How long a spoken exchange stays available to refer back to. Long enough
// to read an answer, think, and ask a follow-up about "that role" or "the
// second one"; short enough that tomorrow's question is not answered in
// terms of yesterday's.
const CONTEXT_TTL_SECONDS = 15 * 60;


export const BLOCK_KINDS = ["stat", "bar", "rows", "note", "chips"];

export const ACCENTS = ["moss", "ember", "tide", "iris"];


// What the model is told it may build with. Kept here, next to the renderer,
// so the vocabulary and its description cannot drift apart.
export const SCREEN_VOCABULARY = `
{
  "accent": "moss" | "tide" | "iris" | "ember",
  "eyebrow": "3-4 word label, uppercase, optional",
  "headline": "one short line, the answer itself, optional",
  "blocks": [
    { "kind": "stat",  "value": "-1.4", "unit": "lb", "label": "since Monday", "tone": "good|bad|flat" },
    { "kind": "bar",   "label": "Groceries", "value": 0.62, "caption": "$340 of $550" },
    { "kind": "rows",  "items": [["8:00a", "HSC 206"], ["9:05a", "ENG 128"]] },
    { "kind": "note",  "text": "one or two sentences" },
    { "kind": "chips", "items": ["122g protein", "2,100 kcal"] }
  ]
}

Rules:
- At most 3 blocks. Two is usually better; this is a 368x448 panel
  on a desk, read at a glance from a metre away, not a report.
- "stat" is the hero. Use it when one number is the answer.
- "bar" value is 0..1 and is the fraction filled; put the real figures in
  caption. Never invent a budget or a target that was not given to you.
- "rows" is for a schedule or a short list; at most 5 rows, left column short.
- Use "ember" as the accent only when something genuinely needs him — it
  means "waiting on you" everywhere else in this system, and spending it on
  a neutral answer is what makes an alert colour stop working.
- Every figure must come from the material you were given. If you do not
  have a number, say so in a note instead of estimating one.
`;


function clampText(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}


// Everything the model returns passes through here before it can reach a
// pixel. Anything unrecognised is dropped, not repaired: a screen missing a
// block is a small disappointment, a screen rendering an unvalidated string
// as a style is a blank panel or worse.
export function sanitiseSpec(raw, { waiting = false } = {}) {

  if (!raw || typeof raw !== "object") return null;

  const blocks = [];

  for (const block of Array.isArray(raw.blocks) ? raw.blocks.slice(0, 3) : []) {

    if (!block || !BLOCK_KINDS.includes(block.kind)) continue;

    if (block.kind === "stat") {
      const value = clampText(String(block.value ?? ""), 10);
      if (!value) continue;
      blocks.push({
        kind: "stat",
        value,
        unit: clampText(block.unit, 12),
        label: clampText(block.label, 34),
        tone: ["good", "bad", "flat"].includes(block.tone) ? block.tone : "flat"
      });
    }

    if (block.kind === "bar") {
      const value = Number(block.value);
      blocks.push({
        kind: "bar",
        label: clampText(block.label, 22) || "",
        value: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0,
        caption: clampText(block.caption, 30)
      });
    }

    if (block.kind === "rows") {
      const items = (Array.isArray(block.items) ? block.items : [])
        .slice(0, 5)
        .map(row => Array.isArray(row)
          ? [clampText(String(row[0] ?? ""), 10), clampText(String(row[1] ?? ""), 26)]
          : null)
        .filter(row => row && row[1]);
      if (items.length) blocks.push({ kind: "rows", items });
    }

    if (block.kind === "note") {
      const text = clampText(block.text, 150);
      if (text) blocks.push({ kind: "note", text });
    }

    if (block.kind === "chips") {
      const items = (Array.isArray(block.items) ? block.items : [])
        .slice(0, 4)
        .map(item => clampText(String(item ?? ""), 24))
        .filter(Boolean);
      if (items.length) blocks.push({ kind: "chips", items });
    }

  }

  if (!blocks.length && !raw.headline) return null;

  // The ember rule, enforced rather than requested.
  //
  // The prompt asks the model to reserve ember for "something needs you",
  // and asked to lay out a neutral answer about weight and spending it
  // reached for ember anyway — it is the most urgent-looking colour on the
  // palette, so of course it did. A rule that only lives in a prompt is a
  // suggestion; the whole system's alert colour is worth more than that.
  const requested = ACCENTS.includes(raw.accent) ? raw.accent : "tide";

  const accent = (requested === "ember" && !waiting) ? "tide" : requested;

  return {
    accent,
    eyebrow: clampText(raw.eyebrow, 24)?.toUpperCase() || null,
    headline: clampText(raw.headline, 60),
    blocks
  };

}


// Ask the model to lay out the answer it just gave.
//
// It is deliberately a second call rather than part of the answering one:
// the router that answers is choosing tools and reading real data, and
// asking it to also art-direct in the same breath is how you get an answer
// that quietly bends to fit a layout.
export async function designDeskScreen({ question, answer, facts = "", waiting = false }) {

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content:
          `You lay out one small screen on a desk device — 368x448, dark, read ` +
          `at a glance. You are given a question that was just asked out loud, ` +
          `the answer that was just spoken back, and the underlying figures.\n\n` +
          `You write BOTH halves of the reply: what the screen shows, and what ` +
          `the voice says. They are different jobs and must not duplicate each ` +
          `other.\n\n` +
          `Return ONLY a JSON object with a "speech" string and the screen in ` +
          `exactly this vocabulary:\n${SCREEN_VOCABULARY}\n\n` +
          `THE SCREEN is for what the ear is bad at: names, numbers, lists, ` +
          `proportions, anything he will want to look back at. Do not ` +
          `transcribe the answer into a note block and call it a screen.\n\n` +
          `THE SPEECH is a person telling him the thing. Rules:\n` +
          `- Never read the screen aloud. "Microsoft, product marketing. ` +
          `Amazon, product marketing" is a list being recited at someone; ` +
          `"Microsoft is the one to move on first, their summer applications ` +
          `open in the next few weeks" is an answer.\n` +
          `- Lead with the thing that actually decides what he does next — ` +
          `what is urgent, what is at risk, what he is getting wrong.\n` +
          `- Plain spoken English. No markdown, no bullet points, no headings, ` +
          `no colons introducing lists. Contractions are good. It is read ` +
          `aloud by a voice in a room, not printed.\n` +
          `- Two to four sentences. If the detail matters it is already on the ` +
          `screen; say what the screen cannot, which is what it MEANS.\n` +
          `- Blunt and specific, his standing instruction. Never soften, never ` +
          `pad, never announce what you are about to say.`
      },
      {
        role: "user",
        content:
          `Asked: ${question}\n\n` +
          `Answered: ${answer}\n\n` +
          `${facts ? `Figures available:\n${facts}` : "(no extra figures)"}"`
      }
    ]

  });

  try {

    const raw = JSON.parse(response.choices[0].message.content);

    const spec = sanitiseSpec(raw, { waiting });

    // The spoken half travels with the screen it belongs to. Falling back to
    // null rather than to the dashboard answer is deliberate: the caller
    // knows what to say if this half is missing, and a silent failure that
    // quietly starts reading markdown aloud again is exactly the regression
    // this whole change exists to prevent.
    const speech = typeof raw?.speech === "string" && raw.speech.trim().length > 8
      ? raw.speech.replace(/\s+/g, " ").trim().slice(0, 900)
      : null;

    return spec ? { ...spec, speech } : (speech ? { speech, blocks: [], accent: "tide" } : null);

  } catch {
    return null;
  }

}


// Stored with its own expiry rather than a timer: serverless has nowhere to
// keep a countdown, and a timestamp means the screen reverts correctly even
// if nothing runs in between.
export async function stashDeskScreen(spec, exchange = null) {

  if (!spec && !exchange) return { stored: false };

  // The screen expires; the conversation does not.
  //
  // Dismissing an answer used to delete the only record that it happened,
  // so "tell me more about that role" had nothing to refer to and the whole
  // exchange was unreachable a tap later. The picture still comes down on
  // its own schedule — a stale answer staring at you is clutter — but what
  // was asked and said stays readable for long enough to talk about.
  const value = {
    spec,
    expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    exchange: exchange || null,
    exchange_expires_at: new Date(Date.now() + CONTEXT_TTL_SECONDS * 1000).toISOString()
  };

  const { error } = await supabase
    .from("app_settings")
    .upsert([{ key: KEY, value, updated_at: new Date().toISOString() }], { onConflict: "key" });

  if (error) {
    console.error("DESK SCREEN stash failed:", error.message);
    return { stored: false };
  }

  return { stored: true, expires_at: value.expires_at };

}


export async function loadDeskScreen() {

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();

  if (error || !data?.value) return null;

  const { spec, expires_at, dismissed } = data.value;

  if (!spec || dismissed || !expires_at || new Date(expires_at) < new Date()) return null;

  return { spec, expiresAt: expires_at };

}


// What was last asked and answered here, for a follow-up to hang off.
export async function loadDeskContext() {

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();

  if (error || !data?.value) return null;

  const { exchange, exchange_expires_at } = data.value;

  if (!exchange || !exchange_expires_at) return null;

  if (new Date(exchange_expires_at) < new Date()) return null;

  return exchange;

}


export async function clearDeskScreen() {

  // Marks the screen down rather than deleting the row, so the exchange
  // behind it survives to be asked about.
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();

  if (!data?.value) return;

  await supabase
    .from("app_settings")
    .upsert([{
      key: KEY,
      value: { ...data.value, dismissed: true },
      updated_at: new Date().toISOString()
    }], { onConflict: "key" });

}
