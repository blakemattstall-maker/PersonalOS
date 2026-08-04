import openai from "../lib/openai.js";
import { executeTool } from "../lib/router.js";
import { buildContext } from "../lib/context.js";
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


    const context = await buildContext();


    const userTimezone = await getUserTimezone();


    const now = DateTime.now()
      .setZone(userTimezone);


    const currentDate = now.toFormat("yyyy-MM-dd");
    const currentTime = now.toFormat("HH:mm");
    const currentDayName = now.toFormat("cccc");

    const upcomingDays = Array.from({ length: 7 }, (_, i) => {
      const d = now.plus({ days: i });
      return `${d.toFormat("cccc")}: ${d.toFormat("yyyy-MM-dd")}`;
    }).join("\n");


    console.log("AI DATE CONTEXT");

    console.log({
      currentDate,
      currentTime,
      timezone: userTimezone
    });


    const response = await openai.chat.completions.create({

      model: "gpt-4o-mini",


      messages: [

        {
          role: "system",

          content: `

You are the planning engine for a personal operating system.

Current local date:
${currentDate} (${currentDayName})

Current local time:
${currentTime}

Timezone:
${userTimezone}

Upcoming 7 days (use this table to resolve weekday names — do not calculate manually):
${upcomingDays}


IMPORTANT DATE LOGIC:

You are responsible for converting human date language into exact dates.

Use the current local date above as the source of truth.

Examples:

If today is 2026-08-02:

"today" = 2026-08-02

"tomorrow" = 2026-08-03

"day after tomorrow" = 2026-08-04

Do NOT add extra days.

Do NOT use server time.

Do NOT assume UTC.


For query_schedule, resolve the range using the upcoming 7 days table above:

"today" = today only
"tomorrow" = tomorrow only
"this week" = today through the coming Sunday
"next few days" = today through 3 days out

If the range is unclear, use today through 7 days out.


User context:

${JSON.stringify(context, null, 2)}


Use the tools available to you to fulfill the user's request. If a single
message asks for more than one thing (e.g. "add the meeting and remind me
to bring the contract"), call every tool needed to satisfy all of it.
`

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
          text
        );

        results.push({ tool: toolName, result });

      } catch (error) {

        anyFailure = true;

        results.push({ tool: toolName, error: error.message });

      }

    }


    return res.status(200).json({

      success: !anyFailure,

      results,

      // Backward-compatible top-level fields for the common single-action case
      tool: results[0]?.tool,
      result: results[0]?.result

    });



  } catch(error) {


    return res.status(500).json({

      error:error.message

    });


  }

}
