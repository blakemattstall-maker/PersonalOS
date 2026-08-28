import openai from "./openai.js";
import { MODELS } from "./models.js";
import { waitUntil } from "@vercel/functions";

// Dependent chains: "research the options, THEN put the findings in a doc,
// THEN draft an email to each person it names." Every tool in this system
// runs blind to the others — the router issues calls in parallel and no
// output feeds an input — which is exactly what a request like that needs
// and exactly what it couldn't have. This runs the steps the way a person
// would: do one, read what it produced, decide the next.
//
// It runs BEHIND the reply (the waitUntil pattern deep thinking proved),
// because a real chain takes tens of seconds and a person at a speaker
// does not. The desk answers "on it" immediately; the finished result
// lands on the dashboard, the phone, and the desk's own screen.
//
// Two hard boundaries:
//   - No surface-jumping tools. A background chain must never open windows
//     on the laptop — that class of action requires a live, explicit voice
//     command, always.
//   - No nesting. A chain cannot start deep thinking or another chain.

const CHAIN_TOOLS = new Set([
  "general_question", "research_query",
  "query_schedule", "query_tasks", "query_notes", "query_projects",
  "query_finances", "query_health", "query_people", "query_connections", "query_work",
  "draft_email", "export_to_doc",
  "create_task", "create_event", "save_note"
]);

const MAX_STEPS = 6;


export async function runChain({ request }) {

  if (!request) {
    return { success: false, message: "I need the whole multi-step request in one go." };
  }

  waitUntil(
    executeChain(request).catch(error => console.error("CHAIN failed:", error.message))
  );

  return {
    success: true,
    message: "On it — I'll work through the steps and put the result on your dashboard and this screen when it's done.",
    data: { request, chained: true }
  };

}


async function executeChain(request) {

  const t0 = Date.now();

  const [{ TOOLS }, { executeTool }] = await Promise.all([
    import("./toolDefinitions.js"),
    import("./router.js")
  ]);

  const tools = TOOLS.filter(t => CHAIN_TOOLS.has(t.function.name));

  const messages = [
    {
      role: "system",
      content:
        `You are executing a multi-step request for your user, one step at a ` +
        `time. Call ONE tool, read its result, then decide the next step — ` +
        `later steps should USE what earlier steps produced (names, figures, ` +
        `links). Only call tools in parallel when the steps genuinely do not ` +
        `depend on each other. When every step is done, reply in plain text ` +
        `with a short factual account of what was done and where it lives ` +
        `(doc created, drafts written, tasks added). No markdown. If a step ` +
        `fails, carry on with what you have and say plainly what failed.`
    },
    { role: "user", content: request }
  ];

  const results = [];
  let final = null;

  for (let step = 0; step < MAX_STEPS && !final; step++) {

    const req = {
      model: MODELS.JUDGMENT,
      // 'none', explicitly: the 5.6 family refuses function tools in chat
      // completions at ANY other effort — the registry's luna note, learned
      // again here for terra ("set reasoning_effort to 'none'", says the
      // 400). Deleting the param does not help; only 'none' does. Step
      // decisions are tool dispatch, not deliberation, so nothing is lost.
      reasoning_effort: "none",
      messages,
      tools,
      tool_choice: "auto"
    };

    let response;

    try {
      response = await openai.chat.completions.create(req);
    } catch (error) {
      if (error.status === 400) {
        delete req.reasoning_effort;
        response = await openai.chat.completions.create(req);
      } else {
        throw error;
      }
    }

    const message = response.choices[0].message;

    messages.push(message);

    if (!message.tool_calls?.length) {
      final = message.content;
      break;
    }

    // Every issued call gets a tool reply (the API requires it); calls in
    // one message were issued together, so running them in order is safe.
    for (const call of message.tool_calls) {

      const toolName = call.function.name;

      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch {}

      let outcome;

      if (!CHAIN_TOOLS.has(toolName)) {
        outcome = { success: false, message: "That tool is not available inside a chain." };
      } else {
        try {
          outcome = await executeTool({ tool: toolName, ...args }, null);
        } catch (error) {
          outcome = { success: false, message: error.message };
        }
      }

      results.push({ tool: toolName, result: outcome });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({
          message: outcome?.message || "",
          data: JSON.stringify(outcome?.data ?? null).slice(0, 1200)
        })
      });

    }

  }

  if (!final) {
    final = "I hit the step limit before finishing — what completed is on the dashboard.";
  }

  console.log(`CHAIN done: ${results.length} steps in ${Math.round((Date.now() - t0) / 1000)}s`);

  // "…and open them on my laptop": when the ORIGINAL spoken request named
  // the laptop, everything the chain produced with a URL — the doc, the
  // draft — opens there on completion. This is not the chain operating the
  // laptop (it still has no laptop tools); it is the user's own explicit
  // instruction, carried out when its results finally exist. The pause
  // switch, the expiry, and the machine-side kill file all still apply at
  // the moment of opening.
  if (/\b(on|to) (my |the )?(laptop|computer|mac)\b/i.test(request)) {

    try {

      const { pushLaptopCommand } = await import("./laptopQueue.js");

      const produced = results
        .filter(r => /^https?:\/\//.test(r.result?.data?.url || ""))
        .map(r => ({ kind: "url", url: r.result.data.url, label: r.tool.replace(/_/g, " ") }));

      for (const command of produced) {
        await pushLaptopCommand(command);
      }

      if (produced.length) {
        final = `${final} I've opened the results on your laptop.`;
        console.log(`CHAIN opened ${produced.length} result(s) on the laptop`);
      }

    } catch (error) {
      console.error("CHAIN laptop delivery failed:", error.message);
    }

  }

  // Delivery, all three surfaces: the phone push + dashboard filing that
  // notifyCapture already owns, and the desk's own composed screen so the
  // finished chain appears on the glass within a poll.
  try {
    const { notifyCapture } = await import("./captureNotify.js");
    await notifyCapture([{ tool: "run_chain", result: { success: true, message: final } }], request);
  } catch (error) {
    console.error("CHAIN notify failed:", error.message);
  }

  try {

    const { designDeskScreen, stashDeskScreen } = await import("./deskScreens.js");

    const facts = results
      .map(r => r.result?.data ? `${r.tool}: ${JSON.stringify(r.result.data).slice(0, 600)}` : null)
      .filter(Boolean)
      .join("\n");

    const spec = await designDeskScreen({ question: request, answer: final, facts, waiting: false });

    await stashDeskScreen(spec?.empty ? null : spec, { question: request, answer: final });

  } catch (error) {
    console.error("CHAIN desk stash failed:", error.message);
  }

}
