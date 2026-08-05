import openai from "../lib/openai.js";
import { createNoteRecord } from "./database.js";


// Live web search — genuinely different from every other tool in this
// system, which all read Supabase or Google. This is the only one that
// reaches the actual internet, via the Responses API's hosted web_search
// tool rather than chat.completions (a different surface, confirmed working
// against real queries before this was built: a real freelance-rate
// question came back with current numbers, real agency names, and real
// cited URLs — not the model's static training data dressed up as current).
//
// Two stated uses: researching a PROJECT (rates, vendors, current
// requirements) and researching a PERSON (background before a meeting or
// outreach) — both are just "a real question, answered with real sources,"
// so one function covers both.

const MODEL = "gpt-5.6-terra";


function extractSources(response) {

  const message = response.output?.find(item => item.type === "message");

  const annotations = message?.content?.[0]?.annotations || [];

  const seen = new Set();
  const sources = [];

  for (const a of annotations) {

    if (a.type !== "url_citation" || !a.url || seen.has(a.url)) continue;

    seen.add(a.url);
    sources.push({ title: a.title || a.url, url: a.url });

  }

  return sources;

}


export async function runWebSearch({ query }) {

  if (!query) throw new Error("runWebSearch requires a query.");

  const response = await openai.responses.create({
    model: MODEL,
    tools: [{ type: "web_search" }],
    input: query
  });

  return {
    answer: response.output_text,
    sources: extractSources(response)
  };

}


function formatWithSources({ answer, sources }) {

  if (sources.length === 0) return answer;

  const list = sources.map(s => `- ${s.title}: ${s.url}`).join("\n");

  return `${answer}\n\nSources:\n${list}`;

}


// The Shortcut-callable version: research something, get a spoken answer
// back immediately, and have it land somewhere so it isn't lost the moment
// the phone screen turns off. Notes are the existing "things to look up
// later" category, so that's where this goes.
export async function researchQuery({ query }) {

  if (!query) throw new Error("A research request needs a query.");

  const result = await runWebSearch({ query });

  const note = await createNoteRecord({
    content: `Research: ${query}\n\n${formatWithSources(result)}`
  });

  return {
    success: true,
    message: result.answer,
    data: { note_id: note.id, sources: result.sources }
  };

}
