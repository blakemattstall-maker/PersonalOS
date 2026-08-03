import openai from "../lib/openai.js";
import { executeTool } from "../lib/router.js";
import { buildContext } from "../lib/context.js";
import { DateTime } from "luxon";


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


    const userTimezone = "America/Los_Angeles";


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

      model: "gpt-4o-mini",


      messages: [

        {
          role: "system",

          content: `

You are the planning engine for a personal operating system.

Current local date:
${currentDate}

Current local time:
${currentTime}

Timezone:
${userTimezone}


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


User context:

${JSON.stringify(context, null, 2)}


Return ONLY valid JSON.


------------------------------------------------

CREATE EVENT

Format:

{
  "tool":"create_event",

  "title":"",

  "year":0,
  "month":0,
  "day":0,

  "hour":0,
  "minute":0,

  "timezone":"America/Los_Angeles",

  "durationMinutes":60
}


------------------------------------------------

CREATE TASK

Format:

{
  "tool":"create_task",

  "title":"",

  "year":0,
  "month":0,
  "day":0,

  "hour":0,
  "minute":0,

  "timezone":"America/Los_Angeles"
}


------------------------------------------------

SAVE MEMORY

Format:

{
  "tool":"save_memory",

  "type":"",

  "content":"",

  "importance":0
}


------------------------------------------------

GENERAL QUESTION

Format:

{
  "tool":"general_question",

  "question":""
}


------------------------------------------------

Examples:


Input:
Add a calendar event tomorrow at 9 AM for breakfast


Output:

{
  "tool":"create_event",

  "title":"Breakfast",

  "year":2026,
  "month":8,
  "day":3,

  "hour":9,
  "minute":0,

  "timezone":"America/Los_Angeles",

  "durationMinutes":60
}


Input:
Remember I prefer direct feedback


Output:

{
  "tool":"save_memory",

  "type":"preference",

  "content":"User prefers direct feedback",

  "importance":9
}

`

        },


        {
          role:"user",
          content:text
        }

      ],


      response_format:{
        type:"json_object"
      }

    });



    const toolData = JSON.parse(
      response.choices[0].message.content
    );


    console.log("TOOL DATA");

    console.log(
      JSON.stringify(toolData, null, 2)
    );


    const result = await executeTool(toolData);


    return res.status(200).json({

      success:true,

      tool:toolData.tool,

      result

    });



  } catch(error) {


    return res.status(500).json({

      error:error.message

    });


  }

}