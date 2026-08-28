import { DateTime } from "luxon";
import { waitUntil } from "@vercel/functions";
import openai from "./openai.js";
import { MODELS } from "./models.js";
import { executeTool } from "./router.js";
import { getUserTimezone } from "./profile.js";
import { transcribeAudio } from "../tools/pitch.js";
import { answerQuestion } from "../tools/answer.js";
import { Downsampler24to16 } from "./pcmStream.js";
import {
  handleDeskCommand,
  boundForSpeech,
  buildRouterRequest,
  DEFERRED_TOOLS
} from "../app/api/capture/handler.js";


// The desk's exchange, as a stream instead of a form submission.
//
// The JSON capture path answers the way a web form does: every stage runs to
// completion, then one response carries everything. Fine for a phone Shortcut
// that shows nothing; punishing for a person standing in front of a speaker —
// measured at 22-27 seconds of silence, most of it stages that did not need
// to finish before the voice could begin.
//
// This path answers the way a person does. One POST carries the raw WAV up;
// the response is a stream of typed frames coming back down:
//
//   'M'  meta, JSON        — what was heard, and how it was handled
//   'A'  audio, raw PCM    — 16kHz mono s16le, sent as it is synthesized
//   'P'  picture, PNG      — the composed answer screen, when it is ready
//   'E'  end, JSON         — the exchange is over (ok or error)
//
// [type:1][length:4 LE][payload] — designed to be parsed by a
// microcontroller, which is why it is not SSE or JSON lines: the audio
// stays binary and the device never guesses where anything ends.
//
// The spoken line streams FIRST out of the answer model (see
// tools/answer.js spokenFirst), so synthesis starts while the full answer is
// still generating; the screen composes in parallel with the audio and
// arrives as a frame mid-speech. Extraction and the stash move behind
// waitUntil — the same pattern deep thinking already uses — because nothing
// the room is waiting on depends on them.


// Speech for the room when nothing wrote a spoken register: strip the
// markdown, keep the first two sentences. The 700-character dashboard bound
// is thirty-plus seconds out of a speaker, which is a monologue — the screen
// carries the rest either way.
function spokenCut(text) {

  const clean = boundForSpeech(text);

  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*/g) || [clean];

  let out = "";

  for (const s of sentences) {
    if (out && out.length + s.length > 300) break;
    out += s;
    if (out.length >= 120 && (out.match(/[.!?]/g) || []).length >= 2) break;
  }

  return out.trim() || clean.slice(0, 300);

}


// Mirrors DESK_INSTRUCTIONS in app/api/tts/route.js — the in-room delivery.
// Duplicated rather than imported: route files export only route handlers
// (Next validates their exports), and these two surfaces are allowed to
// drift apart if the desk's delivery ever needs its own tuning.
const DESK_TTS_INSTRUCTIONS =
  "Read this exactly as written, like a person plainly relaying information " +
  "to someone in the same room. Even, matter-of-fact, unhurried. No " +
  "announcer energy, no performative emphasis, no brightness added to " +
  "neutral facts. Pause properly at full stops.";

const VOICES = new Set([
  "alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"
]);


function frameBuf(type, payload) {

  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload ?? {}));

  const head = Buffer.alloc(5);

  head[0] = type.charCodeAt(0);
  head.writeUInt32LE(body.length, 1);

  return Buffer.concat([head, body]);

}


// Synthesize straight through to the device: OpenAI's raw-PCM stream (24kHz)
// through the stateful resampler, out as audio frames. First frame typically
// leaves ~half a second after the request — that is the whole point.
async function streamTts({ text, voice, speed, send, isClosed = () => false }) {

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODELS.SPEECH,
      voice,
      input: text,
      response_format: "pcm",
      speed,
      instructions: DESK_TTS_INSTRUCTIONS
    })
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`TTS ${res.status}: ${detail.slice(0, 200)}`);
  }

  const reader = res.body.getReader();

  console.log(`DESK tts first byte ready (status ${res.status})`);

  const ds = new Downsampler24to16();

  // Frames capped so the device's ring buffer sees steady, small deliveries
  // rather than one burst it has to absorb whole.
  const CAP = 16 * 1024;

  const emit = (buf) => {
    for (let at = 0; at < buf.length; at += CAP) {
      send("A", buf.subarray(at, Math.min(at + CAP, buf.length)));
    }
  };

  for (;;) {
    if (isClosed()) {
      // Nobody is listening — stop paying for the rest of the synthesis.
      try { await reader.cancel(); } catch {}
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    emit(ds.push(Buffer.from(value)));
  }

  emit(ds.flush());

}


// The composed screen, rendered here and pushed down the same socket, so the
// device never opens a second connection mid-exchange. Failures cost the
// picture, never the voice.
async function composeAndRenderScreen({ send, question, answer, results, device, isClosed }) {

  // The device hung up (an interrupt): nothing composed here would ever be
  // seen, and nothing may be stashed to haunt the next refresh.
  if (isClosed()) return;

  const { designDeskScreen, stashDeskScreen } = await import("./deskScreens.js");

  const facts = results
    .map(r => r.result?.data ? `${r.tool}: ${JSON.stringify(r.result.data).slice(0, 900)}` : null)
    .filter(Boolean)
    .join("\n");

  const waiting = results.some(r => r.result?.data?.waiting);

  const spec = await designDeskScreen({ question, answer, facts, waiting });

  // Design takes seconds; the device may have hung up during them.
  if (isClosed()) return;

  // The stash is what the 60s poll, a tap-dismiss and the next follow-up all
  // read; none of them read it within this response's lifetime.
  waitUntil(
    stashDeskScreen(spec?.empty ? null : spec, { question, answer })
      .catch(error => console.error("DESK stash failed:", error.message))
  );

  if (!spec || spec.empty) return;

  const { renderDeskScreen } = await import("../app/api/[resource]/deskScreen.js");

  const image = await renderDeskScreen({
    spec,
    mic: device.mic,
    asks: device.asks,
    tts: device.tts ? "on" : "off"
  });

  send("P", Buffer.from(await image.arrayBuffer()));

}


// One spoken exchange. Returns a streaming Response; all the work happens
// inside the stream so the first frames leave while later stages still run.
export function deskConverse({ audio, mime, device, signal = null }) {

  // Whether the device is still on the line. Interrupting an exchange
  // ("Jarvis" mid-answer) closes the socket, but the work here kept going:
  // the abandoned answer was composed, STASHED, and resurfaced on the next
  // screen refresh five seconds after the user had already moved on — and a
  // spoken dismissal could not prevent it, because the stash was written
  // after the dismissal landed. An abandoned exchange must leave nothing
  // behind.
  //
  // Two detectors, because each alone missed a case: a failed send only
  // notices the hangup while something is being SENT (an interrupt during
  // thinking sends nothing, and the ghost survived exactly there), and the
  // request's abort signal is the platform's own word that the client
  // dropped, whatever the exchange was doing at the time.
  let closed = false;

  const gone = () => closed || Boolean(signal?.aborted);

  const stream = new ReadableStream({

    cancel() {
      closed = true;
    },

    async start(controller) {

      const send = (type, payload) => {
        if (closed) return;
        try { controller.enqueue(frameBuf(type, payload)); } catch { closed = true; }
      };

      const finish = (end) => {
        send("E", end);
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      };

      try {

        // Everything the router will need, fetched while transcription runs
        // instead of after it — these were three serial reads on the JSON
        // path, none of which look at the transcript.
        const [settings, deskContext, userTimezone, pending, transcript] = await Promise.all([

          import("./settings.js")
            .then(m => m.getSettings())
            .catch(() => ({})),

          import("./deskScreens.js")
            .then(m => m.loadDeskContext())
            .catch(() => null),

          getUserTimezone(),

          import("../tools/pending.js")
            .then(m => m.getPendingClarification())
            .catch(() => null),

          transcribeAudio({ audio_base64: audio.toString("base64"), mime_type: mime })
            .then(r => ({ text: r.text }))
            .catch(error => {
              if (error.code === "NO_SPEECH") return { silent: true };
              throw error;
            })

        ]);

        if (transcript.silent) {
          send("M", { kind: "silent" });
          return finish({ ok: true });
        }

        const text = transcript.text;

        console.log("DESK CONVERSE HEARD:", text);

        const voice = VOICES.has(settings.voice) ? settings.voice : "sage";
        const speed = Math.min(1.6, Math.max(0.7, Number(settings.speech_rate) || 1.15));

        // One TTS stream per exchange, started by whichever path first has
        // something worth saying. Muted means the screen still answers.
        let ttsStarted = null;

        const say = (spokenText) => {
          if (ttsStarted || !device.tts) return;
          const line = (spokenText || "").trim();
          if (!line) return;
          ttsStarted = streamTts({ text: line, voice, speed, send, isClosed: gone })
            .catch(error => {
              console.error("DESK tts failed:", error.message);
              send("M", { kind: "tts-failed" });
            });
        };

        // Spoken controls first — matched, not routed, for the reasons the
        // JSON path documents. Same matcher, so the two paths cannot drift.
        const command = await handleDeskCommand(text);

        if (command) {

          send("M", {
            kind: "command",
            heard: text,
            message: command.result?.message || "",
            ...(command.speech ? { speech: command.speech } : {}),
            ...(command.volume ? { volume: command.volume } : {})
          });

          // "You can talk" must be able to say so: the mute it lifts was
          // still in force when this request arrived.
          if (command.speech === "on") device.tts = true;

          if (command.result?.message) say(command.result.message);

          if (ttsStarted) await ttsStarted;

          return finish({ ok: true });

        }

        // A question the last turn asked back ("which one did you mean?")
        // claims this utterance before the router does — same contract as the
        // JSON path, without which a spoken "the draft one" routes as a fresh
        // request and means nothing.
        if (pending) {

          const [{ resumePendingClarification }, { clearPendingClarification }] = await Promise.all([
            import("../tools/modify.js"),
            import("../tools/pending.js")
          ]);

          const resumed = await resumePendingClarification({ pending, text });

          await clearPendingClarification();

          if (resumed.handled) {

            send("M", { kind: "answer", heard: text });

            say(resumed.result?.message || "Done.");

            waitUntil(
              import("../tools/extract.js")
                .then(m => m.extractDurableFacts(text, [{ tool: "clarification", result: resumed.result }]))
                .catch(error => console.error("DESK extraction failed:", error.message))
            );

            if (ttsStarted) await ttsStarted;

            return finish({ ok: true });

          }

          // Not an answer — they moved on. Route normally.

        }

        send("M", { kind: "answer", heard: text });

        const now = DateTime.now().setZone(userTimezone);

        const routed = await openai.chat.completions.create(
          buildRouterRequest({ now, userTimezone, isDesk: true, deskContext, text })
        );

        const message = routed.choices[0].message;

        const calls = message.tool_calls || [];

        let results = [];
        let fullAnswer = "";

        if (calls.length === 0) {

          // The router answered directly — the fast lane. Short and already
          // conversational, so it goes to the voice as it stands.
          fullAnswer = message.content || "I'm not sure how to help with that.";

          results = [{ tool: "general_question", result: { success: true, message: fullAnswer } }];

          say(spokenCut(fullAnswer));

        } else {

          // The reasoning tools stream their spoken line out mid-generation;
          // everything else runs alongside rather than after. answerQuestion
          // owns general_question here (spokenFirst needs its streaming
          // form); deferred tools still start their dashboard work AND get
          // answered now, same contract as the JSON path.
          const wantsAnswer = calls.some(c =>
            c.function.name === "general_question" || DEFERRED_TOOLS.includes(c.function.name));

          const settled = await Promise.all(calls.map(async (call) => {

            const toolName = call.function.name;

            let args = {};
            try { args = JSON.parse(call.function.arguments || "{}"); } catch {}

            if (toolName === "general_question" && wantsAnswer) {
              // Answered below, with the streaming form.
              return null;
            }

            try {
              const result = await executeTool(
                { tool: toolName, ...args },
                calls.length > 1 && toolName !== "query_health" ? null : text
              );
              return { tool: toolName, result };
            } catch (error) {
              return { tool: toolName, error: error.message };
            }

          }));

          results = settled.filter(Boolean);

          if (wantsAnswer) {

            const answered = await answerQuestion({
              question: text,
              spokenFirst: true,
              onSpoken: (spoken) => say(spoken)
            });

            fullAnswer = answered.message || "";

            const deferred = results.some(r => DEFERRED_TOOLS.includes(r.tool));

            if (deferred && fullAnswer) {
              fullAnswer = `${fullAnswer}\n\n(A fuller breakdown is also being worked through for the dashboard.)`;
            }

            results.push({ tool: "general_question", result: { ...answered, message: fullAnswer } });

            // The model ignored the two-block format: nothing streamed early,
            // so speak the opening of the answer now — two sentences, not the
            // thirty-second dashboard version.
            if (!ttsStarted) say(spokenCut(fullAnswer));

          } else {

            fullAnswer = results
              .map(r => r.result?.message || (r.error ? `Couldn't ${String(r.tool || "do that").replace(/_/g, " ")}: ${r.error}` : null))
              .filter(Boolean)
              .map(m => /[.!?]$/.test(m.trim()) ? m.trim() : `${m.trim()}.`)
              .join(" ");

            // Actions get read back in full — every confirmation was asked
            // for, and there are rarely more than two. Query answers are a
            // dashboard summary wearing a voice, and thirty seconds of one
            // is a monologue: speak the opening, the screen carries the rest.
            const actionsOnly = results.every(r =>
              /^(create|modify|delete|complete|log|start)_/.test(r.tool || ""));

            say(actionsOnly ? boundForSpeech(fullAnswer) : spokenCut(fullAnswer));

          }

        }

        // Durable facts ride behind the response; the room is not waiting on
        // a database write.
        waitUntil(
          import("../tools/extract.js")
            .then(m => m.extractDurableFacts(text, results))
            .catch(error => console.error("DESK extraction failed:", error.message))
        );

        const screenDone = composeAndRenderScreen({
          isClosed: gone,
          send,
          question: text,
          answer: fullAnswer,
          results,
          device
        }).catch(error => console.error("DESK screen failed:", error.message));

        await Promise.all([ttsStarted, screenDone]);

        finish({ ok: true });

      } catch (error) {

        console.error("DESK CONVERSE FAILED:", error.message);

        finish({ error: error.message });

      }

    }

  });

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      // Vercel respects streaming by default; this guards any buffering proxy.
      "x-accel-buffering": "no"
    }
  });

}
