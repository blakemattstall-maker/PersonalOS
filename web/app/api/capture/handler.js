import openai from "../../../lib/openai.js";
import { executeTool } from "../../../lib/router.js";
import { requireAuth } from "../../../lib/auth.js";
import { enforceLimit } from "../../../lib/ratelimit.js";
import { TOOLS } from "../../../lib/toolDefinitions.js";

// Tools whose real output lands later, on the dashboard.
//
// These were briefly removed from the desk's tool list, which fixed the
// symptom ("it'll be on your dashboard in a few minutes" spoken at someone
// standing in front of a speaker) and broke something more important:
// starting a deep analysis by voice, and having it show up on the dashboard
// like anything else, is a thing worth being able to do. So they stay
// available everywhere, and the desk earns an immediate answer alongside.
export const DEFERRED_TOOLS = ["start_deep_thinking"];


// Does this sentence reach back at something already on screen?
//
// "Tell me more about the first one" needs the previous answer; "what is on
// my calendar" emphatically does not, and handing it one invites the model to
// answer the old question again.
export function looksLikeFollowUp(text, previous = null) {

  const said = (text || "").toLowerCase();

  const words = said.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 3) return true;

  if (/\b(that|those|this|these|it|its|the (first|second|third|last|other)|him|her|them|they|again|instead|more (about|info|on|detail)|tell me more|expand|why not|which one|elaborate)\b/.test(said)) {
    return true;
  }

  // Shared subject matter counts as reaching backwards.
  //
  // "More info on the Amtrak" contains no pronoun and no stock phrase, so a
  // keyword list called it a fresh question and answered it with a general
  // encyclopaedia entry instead of the route from campus that had just been
  // discussed. If a distinctive word from the last answer reappears, they are
  // still talking about the same thing.
  if (!previous?.answer) return false;

  const STOP = new Set([
    "about", "there", "which", "would", "could", "should", "these", "those",
    "their", "other", "where", "after", "before", "still", "going", "first",
    "thing", "things", "really", "actual", "point", "right", "great"
  ]);

  const previousWords = new Set(
    previous.answer.toLowerCase().match(/[a-z]{5,}/g)?.filter(w => !STOP.has(w)) || []
  );

  return words.some(w => previousWords.has(w.replace(/[^a-z]/g, "")));

}


// Markdown is for eyes.
//
// The answering tools format for a dashboard, so a good answer comes back
// full of **bold**, bullets and headings. Read aloud that becomes "asterisk
// asterisk Microsoft". The screen carries the structure; the voice needs
// sentences.
function forSpeech(value) {
  return (value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}


// A real answer runs for paragraphs, which is right on a dashboard and
// punishing from a speaker. Cut at a sentence and point at the screen.
export function boundForSpeech(value) {

  const clean = forSpeech(value);

  const LIMIT = 700;

  if (!clean || clean.length <= LIMIT) return clean;

  const cut = clean.slice(0, LIMIT);

  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));

  return `${lastStop > 200 ? cut.slice(0, lastStop + 1) : cut} There's more on the screen.`;

}


// Everything the desk needs after an answer exists: a screen laid out for it,
// and the exchange remembered so the next question can refer back to it.
//
// Called from BOTH return paths. The conversational one — where the router
// answers without calling a tool — used to return raw markdown and compose
// nothing, which is why a follow-up came back as unreadable asterisks on the
// resting face instead of a designed screen.
async function prepareDeskReply({ question, answer, results = [], waiting = false }) {

  try {

    const { designDeskScreen, stashDeskScreen } = await import("../../../lib/deskScreens.js");

    const spec = await designDeskScreen({
      question,
      answer,
      facts: results
        .map(r => r.result?.data ? `${r.tool}: ${JSON.stringify(r.result.data).slice(0, 900)}` : null)
        .filter(Boolean)
        .join("\n"),
      waiting
    });

    // Only stash something worth drawing. An empty spec would replace the
    // resting face with a footer on a black screen.
    await stashDeskScreen(spec?.empty ? null : spec, { question, answer });

    // The composer wrote a line meant to be said out loud, which is not the
    // dashboard answer with its markdown removed — it leads with what
    // actually decides the next move and leaves the names and numbers to the
    // screen. Only fall back to flattening the written answer if that half
    // is missing.
    if (spec?.speech) return spec.speech;

  } catch (error) {
    console.error("DESK SCREEN compose failed:", error.message);
  }

  return boundForSpeech(answer);

}
import { DateTime } from "luxon";
import { getUserTimezone } from "../../../lib/profile.js";
import { getPendingClarification, clearPendingClarification } from "../../../tools/pending.js";
import { resumePendingClarification } from "../../../tools/modify.js";
import { MODELS } from "../../../lib/models.js";
import { transcribeAudio } from "../../../tools/pitch.js";
import { notifyCapture } from "../../../lib/captureNotify.js";

// Everything durable in what he just said, folded into the reply.
//
// Three exit paths return from this handler, not one — the resumed
// clarification, the no-tool-call conversational answer, and the normal tool
// loop — and the utterance that exposed the whole gap ("I'm racing my roommate
// to a muscle-up") took the middle one. A pass bolted onto the end of the tool
// loop would have missed exactly the case it was written for, so it goes
// through here and every path calls it.
//
// Awaited, not fired and forgotten: background work in a serverless function is
// killed the moment the response is sent. Never throws — tools/extract.js
// swallows its own failures — because a fact not saved must not become a
// capture that failed.
//
// It appends to the message rather than adding a result. `result.message` is a
// hard contract: the desk firmware and the Action Button Shortcut both read it
// aloud, and an extra entry in `results` would also make "2 things done" say
// three.
async function withExtraction(text, results, message) {

  const { extractDurableFacts } = await import("../../../tools/extract.js");

  const extracted = await extractDurableFacts(text, results);

  if (!extracted?.summary) return message;

  return message ? `${message} ${extracted.summary}` : extracted.summary;

}


// Spoken controls, answered without the router.
//
// The screen has a tap target for dismissing an answer, which is a nice
// accelerator and a bad requirement: this is meant to be usable with your
// hands full. These are matched rather than routed because they are not
// questions — sending "never mind" to a planning engine invites it to
// helpfully do something, which is precisely what it did: "never mind"
// produced a screen reading "Previous request ignored", and "go back to
// home" pulled up his hometown.
//
// Returns a response body to send, or null to carry on routing.
export async function handleDeskCommand(text) {

  if (typeof text !== "string") return null;

  // The wake word is usually transcribed along with the command, and a
  // transcriber adds punctuation and filler an anchored match will not
  // survive: "Jarvis, never mind." never equalled "never mind".
  const said = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jarvis|hey|ok|okay|um|uh|please|can you|could you|just)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const DISMISS = new RegExp(
    "^(" + [
      "never ?mind", "nevermind", "forget it", "forget that",
      "go back", "go back home", "go home", "back", "home",
      "back to home", "back to the home ?screen", "home ?screen",
      "dismiss( that| it)?", "clear( that| it| the screen)?",
      "close( that| it)?", "hide( that| it)?",
      "put (that|it) away", "get rid of (that|it)", "take (that|it) away",
      "cancel", "stop", "quit", "exit",
      "thats all", "thats it", "were done", "done", "im done",
      "thank you", "thanks", "nothing", "no thanks"
    ].join("|") + ")$"
  );

  if (DISMISS.test(said)) {

    try {
      const { clearDeskScreen } = await import("../../../lib/deskScreens.js");
      await clearDeskScreen();
    } catch (error) {
      console.error("DESK dismiss failed:", error.message);
    }

    // Silent on purpose. Acknowledging "never mind" out loud is the
    // assistant taking the last word.
    return { success: true, tool: "desk_control", result: { success: true, message: "" } };

  }

  const REPEAT = /^(repeat( that)?|say that again|what did you say|again)$/;

  if (REPEAT.test(said)) {

    try {

      const { loadDeskContext } = await import("../../../lib/deskScreens.js");

      const previous = await loadDeskContext();

      if (previous?.answer) {
        return {
          success: true,
          tool: "desk_control",
          result: { success: true, message: boundForSpeech(previous.answer) }
        };
      }

    } catch (error) {
      console.error("DESK repeat failed:", error.message);
    }

    return { success: true, tool: "desk_control", result: { success: true, message: "" } };

  }

  // Speech on and off, by voice as well as by the button on the screen.
  if (/^(be quiet|quiet|mute|stop talking|no (more )?(voice|talking|audio|sound)|voice off|dont talk)$/.test(said)) {
    return { success: true, tool: "desk_control", speech: "off",
             result: { success: true, message: "" } };
  }

  if (/^(speak|talk|voice on|unmute|you can talk|start talking)$/.test(said)) {
    return { success: true, tool: "desk_control", speech: "on",
             result: { success: true, message: "Voice is back on." } };
  }

  // Volume, in steps. The device owns the actual level (it owns the codec);
  // this just tells it which way. Silent on purpose — the next answer
  // demonstrates the change better than an announcement at the old volume.
  if (/^(louder|volume up|turn (it|that|the volume) up|speak up)$/.test(said)) {
    return { success: true, tool: "desk_control", volume: "up",
             result: { success: true, message: "" } };
  }

  if (/^(quieter|softer|lower|volume down|turn (it|that|the volume) down|not so loud)$/.test(said)) {
    return { success: true, tool: "desk_control", volume: "down",
             result: { success: true, message: "" } };
  }

  return null;

}


// The routing request, buildable from outside the handler.
//
// The desk's streaming exchange (lib/deskConverse.js) routes the same words
// through the same tools with the same date context — and a second copy of
// this prompt would drift the moment one of them was tuned. One builder, two
// callers.
export function buildRouterRequest({ now, userTimezone, isDesk, deskContext, text }) {

  const currentTime = now.toFormat("HH:mm");

  return {

    // gpt-4o-mini needed a hand-written weekday table and worked examples to
    // get relative dates right, and still missed "a week from tomorrow".
    // A current model gets them right from the date alone, which is why the
    // scaffolding below is gone. Measured 10/11 on a routing eval either
    // way, with a third of the prompt. Memories used to be injected here
    // too — the router picks a tool and extracts arguments, and never needed
    // them; the tools that actually reason pull their own rich context.
    model: MODELS.ROUTER,


    messages: [

      {
        role: "system",

        content: `You are the planning engine for a personal operating system.

Right now it is ${now.toFormat("cccc, yyyy-MM-dd")} at ${currentTime} in ${userTimezone}.
Resolve every relative date ("tomorrow", "this Thursday", "a week from tomorrow") against that, in that timezone.

FIRST decide which of these the user is doing:

1. CHANGING something that already exists — move, push, reschedule, shift,
   bump, mark done, finished, did it, cancel, delete, drop, get rid of.
   -> modify_event for anything on the calendar, modify_task for a to-do.
   Do this even when they name a day or time; "move my dentist appointment
   to Thursday" is modify_event, not a schedule question. Do not look it up
   first — these tools find it themselves from the words the user used, and
   will say so if nothing matches. Never answer a change request with a
   query tool.

2. MAKING something new -> create_event or create_task.

3. ASKING about what already exists -> the query tools. For query_schedule
   choose a range: "today" is today only; "this week" runs through the
   coming Sunday; if unclear use today through 7 days out.

Call every tool needed to satisfy the request — if one message asks for two things, make two calls.
${isDesk ? `
THIS REQUEST CAME FROM THE DESK DEVICE. It was spoken out loud, and the user
is standing in front of a small screen and a speaker expecting to be answered
now. Prefer tools that answer from what is already known; when nothing more
specific fits, general_question can answer from the full profile, memories
and current figures. Starting a deep analysis is still allowed when the
question genuinely deserves one — it will be answered immediately as well.` : ""}`

      },


      {
        role: "user",
        // Context is offered, not imposed.
        //
        // The first version prefixed every desk question with the previous
        // answer and told the model they were related. One weak answer then
        // poisoned everything after it: asked a fresh question, the model
        // read the stale answer as the established position and restated it
        // — "there isn't a recommendation yet" — instead of answering. So
        // it is attached only when the new words actually reach backwards,
        // and even then it is labelled as background that may be irrelevant.
        content: (deskContext && looksLikeFollowUp(text, deskContext))
          ? `[Background — the desk was just asked "${deskContext.question}" and answered:\n` +
            `${deskContext.answer}\n` +
            `Use this ONLY to resolve what the new request points at. If the new ` +
            `request stands on its own, ignore all of it and answer afresh.]\n\n` +
            `${text}`
          : text
      }

    ],


    tools: TOOLS,

    tool_choice: "auto"

  };

}


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

  // A capture can carry audio through Whisper and always runs the router
  // model. Thirty a minute is several times the realistic burst (a walk's
  // worth of voice notes arriving together) and nothing like a loop.
  if (!enforceLimit(req, res, { name: "capture", limit: 30 })) return;

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    // Capture takes either typed text or a recording.
    //
    // iOS's Dictate Text action is free and instant, but it has effectively no
    // punctuation model and it stops the moment you pause — which is what
    // people do mid-sentence when they're thinking. Sending the audio instead
    // and transcribing it server-side costs a fraction of a cent per capture
    // and produces something the router can actually parse.
    //
    // Transcription happens before anything else, so the entire pipeline below
    // — pending clarifications, routing, tool execution — is identical either
    // way and there is only one path to keep working.
    // Where this capture came from decides which tools are usable and
    // whether the answer has to be speakable.
    const isDesk = req.body?.surface === "desk";

    // What the desk is showing right now, so "tell me more about that role"
    // has something to point at. Absent for every other surface, and absent
    // once it has gone stale.
    let deskContext = null;

    if (isDesk) {
      try {
        const { loadDeskContext } = await import("../../../lib/deskScreens.js");
        deskContext = await loadDeskContext();
      } catch (error) {
        console.error("DESK context unavailable:", error.message);
      }
    }

    let { text } = req.body;

    if (isDesk && typeof text === "string" && text.trim()) {
      const handled = await handleDeskCommand(text);
      if (handled) return res.status(200).json(handled);
    }

    let transcription = null;

    if (!text && req.body?.audio_base64) {

      let result;

      try {

        result = await transcribeAudio({
          audio_base64: req.body.audio_base64,
          mime_type: req.body.mime_type
        });

      } catch (error) {

        // Nothing was said. That is not a failure worth a notification, a
        // routed action or a spoken apology — it is a non-event, and the
        // only correct response to it is silence.
        if (error.code === "NO_SPEECH") {
          return res.status(200).json({ success: true, silent: true, result: { message: "" } });
        }

        throw error;

      }

      text = result.text;

      // Only now is there anything to match against. This check used to sit
      // above transcription, where `text` is always empty for a spoken
      // capture, so it never ran for the one surface it was written for.
      if (isDesk) {
        const handled = await handleDeskCommand(text);
        if (handled) return res.status(200).json(handled);
      }

      transcription = { model: result.model, text };

      console.log("CAPTURE TRANSCRIBED:", text);

    }


    if (!text) {
      return res.status(400).json({
        error: "No text or audio provided."
      });
    }


    // If the last turn ended in "which one did you mean?", try this utterance
    // as the answer before routing it as a fresh command. The Shortcut has no
    // conversation of its own, so without this the question could never be
    // answered — "the draft one" means nothing to the router on its own.
    const pending = await getPendingClarification();

    if (pending) {

      const resumed = await resumePendingClarification({ pending, text });

      await clearPendingClarification();

      if (resumed.handled) {

        const answered = {
          ...resumed.result,
          message: await withExtraction(text, [{ tool: "clarification", result: resumed.result }], resumed.result.message)
        };

        const settled = [{ tool: "clarification", result: answered }];

        // Same rule as the main path: the desk answered out loud in the room.
        if (!isDesk) await notifyCapture(settled, text);

        return res.status(200).json({
          success: answered.success,
          results: settled,
          tool: "clarification",
          result: answered
        });

      }

      // Not an answer — the user moved on. Fall through and route normally.

    }


    const userTimezone = await getUserTimezone();


    const now = DateTime.now()
      .setZone(userTimezone);


    const currentDate = now.toFormat("yyyy-MM-dd");
    const currentTime = now.toFormat("HH:mm");


    console.log("AI DATE CONTEXT");

    console.log({
      currentDate,
      currentTime,
      timezone: userTimezone
    });


    const response = await openai.chat.completions.create(
      buildRouterRequest({ now, userTimezone, isDesk, deskContext, text })
    );


    const message = response.choices[0].message;


    console.log("TOOL CALLS");

    console.log(
      JSON.stringify(message.tool_calls, null, 2)
    );


    if (!message.tool_calls || message.tool_calls.length === 0) {

      const answer = {
        success: true,
        message: message.content || "I'm not sure how to help with that."
      };

      // The router answered conversationally instead of calling a tool. With
      // the Shortcut silent this notification is the entire reply, so it
      // matters most on exactly the path that produces no artefact to link to.
      //
      // This ALSO files the answer as a prompt when it needs a home — a push
      // truncates and is gone once swiped, so a long answer has to live
      // somewhere. That used to be done here as well, with its own insert
      // right after this line, and the result was every conversational answer
      // appearing on the dashboard twice, 0.8 seconds apart. fileAnswer in
      // lib/captureNotify.js is the one owner of that decision now; it knows
      // both the length and whether the notification is going to be shown at
      // all, which is more than this branch could see.
      answer.message = await withExtraction(text, [{ tool: "general_question", result: answer }], answer.message);

      if (!isDesk) await notifyCapture([{ tool: "general_question", result: answer }], text);

      // The desk answers out loud and on a screen, on every path that
      // produces an answer — including this one, which returns before the
      // tool machinery below ever runs.
      if (isDesk) {

        const spoken = await prepareDeskReply({
          question: transcription?.text || text,
          answer: answer.message
        });

        return res.status(200).json({
          success: true,
          tool: "general_question",
          result: { ...answer, message: spoken }
        });

      }

      return res.status(200).json({
        success: true,
        tool: "general_question",
        result: answer
      });

    }


    const results = [];
    let anyFailure = false;

    // Query tools are handed the user's exact words so nothing is lost in
    // paraphrase — right for one tool, wrong for several. Asking "what's on
    // my schedule today and am I behind on anything" sent the whole sentence
    // to both, so query_schedule tried to answer the tasks half and replied
    // "I can't tell if you're behind" immediately before query_tasks said
    // "yes, you're behind on two." For multi-tool turns each tool instead
    // gets the scoped question the model extracted for it.
    const isMultiAction = message.tool_calls.length > 1;

    for (const call of message.tool_calls) {

      const toolName = call.function.name;

      let args = {};

      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch (parseError) {
        args = {};
      }

      try {

        // Scoped questions for scoped tools — but the catch-all reasoner and
        // the health tool always get the user's verbatim words. On a
        // multi-tool turn the router once rephrased "analysis of my cut so
        // far" into "...if I don't have the user's exact stats?" for
        // general_question, and the answerer obediently disclaimed data it
        // was holding. A rephrase must never be able to assert facts about
        // what the system knows.
        const wantsVerbatim = toolName === "general_question" || toolName === "query_health"
          || toolName === "query_work";

        const result = await executeTool(
          { tool: toolName, ...args },
          isMultiAction && !wantsVerbatim ? null : text
        );

        results.push({ tool: toolName, result });

      } catch (error) {

        anyFailure = true;

        results.push({ tool: toolName, error: error.message });

      }

    }


    // "Add the meeting and remind me to bring the contract" ran both tools but
    // only ever reported the first one back, so the phone said "Created event"
    // and stayed silent about the reminder. Stitch every message together so
    // the spoken reply covers everything that actually happened.
    let spokenMessage = results
      // Named, not anonymous: "That one failed" leaves the useful half out.
      .map(r => r.result?.message || (r.error ? `Couldn't ${String(r.tool || "do that").replace(/_/g, " ")}: ${r.error}` : null))
      .filter(Boolean)
      // Tool messages don't all end in punctuation ("Created task \"X\""), and
      // run together they read badly when spoken aloud.
      .map(m => /[.!?]$/.test(m.trim()) ? m.trim() : `${m.trim()}.`)
      .join(" ");


    const spokenWithExtras = await withExtraction(text, results, spokenMessage);

    // The extraction line rides on the LAST result rather than becoming its own
    // entry, so describeCapture speaks it without "2 things done" turning into
    // three.
    if (spokenWithExtras !== spokenMessage && results.length > 0) {
      const last = results[results.length - 1];
      if (last.result?.message) {
        last.result = { ...last.result, message: `${last.result.message} ${spokenWithExtras.slice(spokenMessage.length).trim()}` };
      }
    }

    // The desk device asks for a picture of the answer, not just the answer.
    // Only when the caller says it is the desk: a capture from the phone
    // Shortcut has no screen waiting on it, and paying for a layout nobody
    // will look at is waste.
    // A deferred tool still owes the room an answer.
    //
    // start_deep_thinking does the right thing — it starts real analysis and
    // puts the result on the dashboard — but on its own it leaves somebody
    // standing at a speaker having been told to go look at a website.
    //
    // This has to happen BEFORE the screen and the spoken line are composed,
    // which is the ordering bug it shipped with: the composer ran first, saw
    // only "I'll have a breakdown ready in a few minutes", and faithfully
    // wrote speech about having nothing to say yet. The dashboard work still
    // proceeds untouched; the question is also answered now.
    let answerForDesk = spokenWithExtras;

    if (isDesk && results.some(r => DEFERRED_TOOLS.includes(r.tool))) {

      try {

        const { answerQuestion } = await import("../../../tools/answer.js");

        const immediate = await answerQuestion({ question: transcription?.text || text });

        if (immediate?.message) {
          answerForDesk = `${immediate.message}\n\n(A fuller breakdown is also being worked through for the dashboard.)`;
        }

      } catch (error) {
        console.error("DESK immediate answer failed:", error.message);
      }

    }


    let deskSpoken = null;

    if (isDesk) {
      deskSpoken = await prepareDeskReply({
        question: transcription?.text || text,
        answer: answerForDesk,
        results,
        waiting: Boolean(results.some(r => r.result?.data?.waiting))
      });
    }


    // Awaited rather than fired and forgotten. A capture that reports nothing
    // is indistinguishable from one that never arrived, and background work in
    // a serverless function can be killed the moment the response is sent.
    //
    // Skipped for the desk: it already spoke the answer out loud in the room,
    // so a phone notification saying the same thing is the app talking over
    // itself. This is also what was sending mystery notifications while the
    // desk device was being tested.
    if (!isDesk) {
      await notifyCapture(results, transcription?.text || text);
    }


    // Spoken aloud, so it has to end somewhere.
    //
    // A real answer to "what internships should I apply to" runs for
    // paragraphs, which is right on a dashboard and punishing from a speaker
    // on a desk. The screen carries the structure; the voice carries as much
    // as a person will actually stand and listen to, cut at a sentence.
    return res.status(200).json({

      success: !anyFailure,

      results,

      // What it heard. Worth returning even though nothing requires it: when a
      // spoken capture does the wrong thing, the only useful question is
      // whether it misheard you or misrouted you, and without this there's no
      // way to tell them apart from the phone.
      ...(transcription ? { heard: transcription.text } : {}),

      // Backward-compatible top-level fields. A single action returns exactly
      // what it always did; only the multi-action case rewrites the message.
      tool: results[0]?.tool,

      // The phone's contract is unchanged: one tool returns exactly what
      // that tool said. The desk always gets the stitched, length-bounded
      // version, because it has to be read aloud in a room.
      result: (results.length === 1 && !isDesk)
        ? results[0]?.result
        : { ...(results[0]?.result || { success: !anyFailure }), message: deskSpoken ?? spokenWithExtras }

    });



  } catch(error) {


    // Nothing else will say so. The Shortcut shows nothing now, so an
    // unhandled failure here would otherwise be completely invisible from the
    // phone — the capture would simply appear to vanish.
    await notifyCapture(
      [{ tool: "capture", error: error.message }],
      typeof req.body?.text === "string" ? req.body.text : null
    );


    return res.status(500).json({

      error:error.message

    });


  }

}
