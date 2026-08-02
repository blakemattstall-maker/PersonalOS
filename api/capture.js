import openai from "../lib/openai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const { text } = req.body;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are an intent classifier for a personal operating system.

Return only JSON.

Possible intents:
- create_task
- create_event
- save_memory
- general_question

Example:

Input:
"Remind me to call John tomorrow"

Output:
{
  "intent": "create_task",
  "title": "Call John",
  "due": "tomorrow"
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

  const result = JSON.parse(
    response.choices[0].message.content
  );

  res.status(200).json(result);
}