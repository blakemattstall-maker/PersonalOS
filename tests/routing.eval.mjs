// Routing eval — does the router pick the right tool?
//
// Separate from `npm test` on purpose: this one costs money and needs network,
// so it must never be something you avoid running the fast suite because of.
// Run it with `npm run test:routing`.
//
// Two rules here come straight from a bug that reached production, recorded as
// trap #5 in docs/PersonalOS-Current-State-Handoff.md:
//
//   "Single-sample evals hide flakiness. 'Move my dentist appointment to
//    Thursday' passed once and still failed in production. Run routing evals 4x
//    per phrase, and have the eval parse the real prompt out of api/capture.js
//    so it can't drift."
//
// So: every phrase runs RUNS times and must pass every time, and the system
// prompt is extracted from the live source rather than copied here. A copied
// prompt would keep passing after the real one changed, which is worse than no
// eval at all.

import fs from "node:fs";
import { DateTime } from "luxon";

import openai from "../web/lib/openai.js";
import { TOOLS } from "../web/lib/toolDefinitions.js";
import { MODELS } from "../web/lib/models.js";


const RUNS = 4;

const TIMEZONE = "America/Chicago";


// Cases are (phrase -> acceptable tools). More than one is allowed only where
// the ambiguity is genuine and both answers serve the user.
const CASES = [

  // The known-flaky one. This is the whole reason the eval exists.
  ["Move my dentist appointment to Thursday",            ["modify_event"]],
  ["Push my dentist thing to next week",                 ["modify_event"]],
  ["Cancel the meeting with Sam",                        ["modify_event"]],

  ["Mark the laundry task done",                         ["modify_task"]],
  ["I finished the reading for class",                   ["modify_task"]],
  ["Delete the task about the essay",                    ["modify_task"]],

  ["Add a dentist appointment Thursday at 3",            ["create_event"]],
  ["Remind me to email my professor tomorrow",           ["create_task"]],

  ["What's on my schedule today",                        ["query_schedule"]],
  ["What do I have this week",                           ["query_schedule"]],
  ["Am I behind on anything",                            ["query_tasks"]],
  ["What did I write down about the marketing project",  ["query_notes"]],
  ["How much did I spend last week",                     ["query_finances"]],
  ["How's the internship project going",                 ["query_projects"]],

  ["Remember that I hate morning meetings",              ["save_memory"]],
  ["I want to start going to the gym again",             ["save_intention"]],
  ["Note that the library closes at 10 on Fridays",      ["save_note"]],

  ["Help me think through whether to rush a fraternity", ["start_deep_thinking"]],
  ["I weighed 172 this morning",                         ["log_bodyweight"]],

  ["Sarah is my roommate, her birthday is March 4",      ["save_person"]],
  ["I called my mom today",                              ["log_contact"]],

  // Drafting vs. every other "write something down" tool. The trap is
  // save_note, which is also "capture some text" — the distinguishing feature
  // is that an email is addressed to a person and meant to leave.
  ["Draft an email to my professor asking for an extension on the essay", ["draft_email"]],
  ["Write Sarah an email about the trip",                ["draft_email"]],

  // Documents vs. notes vs. research. All three "produce written output"; the
  // difference is a formatted multi-section document meant to be read or sent,
  // versus one fact to look up later, versus a spoken answer.
  ["Make me a list of interview questions for the Acme product manager role and put it in a doc", ["export_to_doc"]],
  ["Write up a training plan for a half marathon and export it to Google Docs", ["export_to_doc"]],

  // The near-miss in the other direction: this is a question to be answered
  // out loud, not a document to be produced.
  ["Research the going rate for a freelance video editor", ["research_query"]]

];


// Extract the live system prompt rather than duplicating it. The marker is
// asserted in tests/contract.test.js so this can't silently start matching
// nothing.
function liveSystemPrompt(now) {

  const source = fs.readFileSync(new URL("../web/app/api/capture/handler.js", import.meta.url), "utf8");

  const match = source.match(/content:\s*`(You are the planning engine[\s\S]*?)`\n/);

  if (!match) {
    throw new Error(
      "Could not extract the router prompt from api/capture.js. " +
      "The eval must test the real prompt — fix the extraction rather than pasting a copy here."
    );
  }

  // The prompt is a template literal with three interpolations. Rebuild them
  // exactly as capture.js does.
  return match[1]
    .replace("${now.toFormat(\"cccc, yyyy-MM-dd\")}", now.toFormat("cccc, yyyy-MM-dd"))
    .replace("${currentTime}", now.toFormat("HH:mm"))
    .replace("${userTimezone}", TIMEZONE);

}


async function route(prompt, text) {

  const response = await openai.chat.completions.create({
    model: MODELS.ROUTER,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: text }
    ],
    tools: TOOLS,
    tool_choice: "auto"
  });

  return (response.choices[0].message.tool_calls || []).map(c => c.function.name);

}


async function main() {

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Run with the key in the environment, or `vercel env pull` first.");
    process.exit(2);
  }

  const now = DateTime.now().setZone(TIMEZONE);

  const prompt = liveSystemPrompt(now);

  console.log(`Routing eval — ${CASES.length} phrases x ${RUNS} runs, model ${MODELS.ROUTER}\n`);

  let failed = 0;

  for (const [text, acceptable] of CASES) {

    const runs = await Promise.all(
      Array.from({ length: RUNS }, () => route(prompt, text).catch(e => [`ERROR:${e.message}`]))
    );

    // Every run must land on an acceptable tool. A phrase that passes 3/4 is a
    // failure, not a pass — that is the entire lesson of trap #5.
    const results = runs.map(tools => tools.find(t => acceptable.includes(t)) || tools.join("+") || "(none)");

    const ok = results.every(r => acceptable.includes(r));

    if (!ok) failed++;

    const tally = [...new Set(results)]
      .map(r => `${r} x${results.filter(x => x === r).length}`)
      .join(", ");

    console.log(`${ok ? "PASS" : "FAIL"}  ${text}`);
    console.log(`      expected ${acceptable.join(" | ")} — got ${tally}\n`);

  }

  console.log(`${CASES.length - failed}/${CASES.length} phrases passed all ${RUNS} runs.`);

  process.exit(failed > 0 ? 1 : 0);

}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
