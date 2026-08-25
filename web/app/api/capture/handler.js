import openai from "../../../lib/openai.js";
import { executeTool } from "../../../lib/router.js";
import { requireAuth } from "../../../lib/auth.js";
import { enforceLimit } from "../../../lib/ratelimit.js";
import { TOOLS } from "../../../lib/toolDefinitions.js";
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
    let { text } = req.body;

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

        await notifyCapture(settled, text);

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


    const response = await openai.chat.completions.create({

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

Call every tool needed to satisfy the request — if one message asks for two things, make two calls.`

        },


        {
          role:"user",
          content:text
        }

      ],


      tools: TOOLS,

      tool_choice: "auto"

    });


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

      await notifyCapture([{ tool: "general_question", result: answer }], text);

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
        const wantsVerbatim = toolName === "general_question" || toolName === "query_health";

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
    const spokenMessage = results
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
    //
    // Only when the caller says it is the desk: a capture from the phone
    // Shortcut has no screen waiting on it, and paying for a layout nobody
    // will look at is waste. Best-effort throughout — a screen that fails to
    // compose costs the picture, never the action that was already taken or
    // the words that are about to be spoken.
    if (req.body?.surface === "desk") {

      try {

        const { designDeskScreen, stashDeskScreen } = await import("../../../lib/deskScreens.js");

        const spec = await designDeskScreen({
          question: transcription?.text || text,
          answer: spokenMessage,
          // Ember is only available to the composer when something genuinely
          // is waiting; see sanitiseSpec.
          waiting: Boolean(results.some(r => r.result?.data?.waiting)),
          facts: results
            .map(r => r.result?.data ? `${r.tool}: ${JSON.stringify(r.result.data).slice(0, 900)}` : null)
            .filter(Boolean)
            .join("\n")
        });

        await stashDeskScreen(spec);

      } catch (error) {
        console.error("DESK SCREEN compose failed:", error.message);
      }

    }


    // Awaited rather than fired and forgotten. A capture that reports nothing
    // is indistinguishable from one that never arrived, and background work in
    // a serverless function can be killed the moment the response is sent.
    //
    // Skipped for the desk: it already spoke the answer out loud in the room,
    // so a phone notification saying the same thing is the app talking over
    // itself. This is also what was sending mystery notifications while the
    // desk device was being tested.
    if (req.body?.surface !== "desk") {
      await notifyCapture(results, transcription?.text || text);
    }


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

      result: results.length === 1
        ? results[0]?.result
        : { ...(results[0]?.result || { success: !anyFailure }), message: spokenWithExtras }

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
