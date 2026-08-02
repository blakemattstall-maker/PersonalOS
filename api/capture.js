import openai from "../lib/openai.js";
import { executeTool } from "../router.js";

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

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are the tool planner for a personal operating system.

Current date/time: ${today}
User timezone: America/Los_Angeles.

Return ONLY valid JSON.

Your job is to determine which tool should run and extract the required information.

Important:
- Understand dates and times from user requests.
- Do NOT calculate dates.
- Do NOT convert dates into timestamps.
- Preserve relative dates exactly as the user said them.
- Return natural language dates like "tomorrow", "Friday", or "next week".

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
  "date": "",
  "time": "",
  "durationMinutes": 60
}

save_memory:
{
  "tool": "save_memory",
  "text": ""
}

general_question:
{
  "tool": "general_question",
  "question": ""
}


Examples:

Input:
"Remind me to call John tomorrow"

Output:
{
  "tool": "create_task",
  "title": "Call John",
  "due": "tomorrow"
}


Input:
"Schedule a dentist appointment this Friday at 2pm"

Output:
{
  "tool": "create_event",
  "title": "Dentist appointment",
  "date": "this Friday",
  "time": "2pm",
  "durationMinutes": 60
}
`
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: {
        type: "json_object"
      }
    });

    const toolData = JSON.parse(
      response.choices[0].message.content
    );

    console.log(toolData);

    const result = await executeTool(toolData);

    return res.status(200).json({
      success: true,
      tool: toolData.tool,
      result
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}