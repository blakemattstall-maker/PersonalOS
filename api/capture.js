import openai from "../lib/openai.js";
import { executeTool } from "../lib/router.js";
import { TOOLS } from "../lib/toolDefinitions.js";
import { DateTime } from "luxon";
import { getUserTimezone } from "../lib/profile.js";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    const { text } = req.body;


    if (!text) {
      return res.status(400).json({
        error: "No text provided."
      });
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
      model: "gpt-5.4-mini",


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

      return res.status(200).json({
        success: true,
        tool: "general_question",
        result: {
          success: true,
          message: message.content || "I'm not sure how to help with that."
        }
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

        const result = await executeTool(
          { tool: toolName, ...args },
          isMultiAction ? null : text
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
      .map(r => r.result?.message || (r.error ? `That one failed: ${r.error}` : null))
      .filter(Boolean)
      // Tool messages don't all end in punctuation ("Created task \"X\""), and
      // run together they read badly when spoken aloud.
      .map(m => /[.!?]$/.test(m.trim()) ? m.trim() : `${m.trim()}.`)
      .join(" ");


    return res.status(200).json({

      success: !anyFailure,

      results,

      // Backward-compatible top-level fields. A single action returns exactly
      // what it always did; only the multi-action case rewrites the message.
      tool: results[0]?.tool,

      result: results.length === 1
        ? results[0]?.result
        : { ...(results[0]?.result || { success: !anyFailure }), message: spokenMessage }

    });



  } catch(error) {


    return res.status(500).json({

      error:error.message

    });


  }

}
