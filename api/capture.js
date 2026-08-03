import openai from "../lib/openai.js";
import { executeTool } from "../lib/router.js";
import { buildContext } from "../lib/context.js";

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

    const today = new Date().toISOString();

    const context = await buildContext();

    console.log("USER CONTEXT:");
    console.log(JSON.stringify(context, null, 2));

    const response = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [
        {
          role: "system",
          content: `
You are the tool planner for a personal operating system.

Current date/time: ${today}
User timezone: America/Los_Angeles.

User context:

${JSON.stringify(context, null, 2)}

Current date/time: ${today}
User timezone: America/Los_Angeles.

Return ONLY valid JSON.

Your job:
1. Determine the correct tool.
2. Extract the required information.
3. Decide if information should be permanently remembered.

---

MEMORY RULES:

You have a memory system.

Use save_memory ONLY for information that improves future interactions.

ALWAYS save:

- Long term goals
- Personal preferences
- Recurring habits
- Important relationships
- Personal constraints
- Strong likes/dislikes
- Decisions that affect future planning

Examples:
"I want to become a product manager"
"I prefer direct feedback"
"My girlfriend's birthday is March 5th"
"I train 5 days per week"

---

DO NOT save:

- One-time events
- Temporary emotions
- Random conversation details
- Calendar events
- Tasks
- Information only useful for today

Examples:
"My dentist appointment is Friday"
"I need groceries"
"I'm tired today"

---

For memories:
Choose a type:

preference
goal
habit
relationship
fact
constraint

Return:

{
  "tool":"save_memory",
  "type":"",
  "content":"",
  "importance":1-10
}

Importance:

10 = critical life information
8-9 = important long term preference/goal
5-7 = useful context
1-4 = minor information

---

DATE RULES:

- Do NOT calculate dates.
- Do NOT convert dates into timestamps.
- Do NOT invent dates.

For dates like "the 8th", "the 15th", or "on the 20th":
include the month if it is not already provided.

Example:

User:
"on the 8th at 3pm"

Return:

"August 8 at 3pm"


If the user gives only a time:

- If that time is still ahead today, assume today.
- Otherwise assume tomorrow.
- Never assume next week unless explicitly stated.

---

Available tools:

create_task:

{
  "tool": "create_task",
  "title": "",
  "due": ""
}


create_event:

{
  "tool": "create_event",
  "title": "",
  "when": "",
  "durationMinutes":60
}


save_memory:

{
  "tool": "save_memory",
  "type":"",
  "content":"",
  "importance":0
}


general_question:

{
  "tool":"general_question",
  "question":""
}



Examples:

Input:
"Remind me to call John tomorrow"

Output:

{
  "tool":"create_task",
  "title":"Call John",
  "due":"tomorrow"
}


Input:
"Schedule a dentist appointment this Friday at 2pm"

Output:

{
  "tool":"create_event",
  "title":"Dentist appointment",
  "when":"this Friday at 2pm",
  "durationMinutes":60
}


Input:
"Remember I prefer lifting in the morning"

Output:

{
  "tool":"save_memory",
  "type":"preference",
  "content":"User prefers lifting in the morning",
  "importance":8
}


Input:
"My goal is to lose 30 pounds by summer"

Output:

{
  "tool":"save_memory",
  "type":"goal",
  "content":"User wants to lose 30 pounds by summer",
  "importance":10
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


    console.log("TOOL DATA:");
    console.log(toolData);


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