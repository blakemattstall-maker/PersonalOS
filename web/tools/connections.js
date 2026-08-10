import openai from "../lib/openai.js";
import { resolveReference } from "../lib/links.js";
import { MODELS } from "../lib/models.js";


// "What's going on with the thing with Priya?" — answered from the graph.
//
// This is the capture-side home for resolveReference(). Until now the graph was
// readable from the dashboard (/graph) and rode silently inside other reasoning
// calls (connectionsForText in buildRichContext), but nothing could be ASKED
// about connections from the Shortcut. This tool is that surface.
//
// It composes three existing primitives and adds no new machinery:
//   - resolveReference() turns oblique words into real entities the graph holds,
//     and reports honestly whether the reference was ambiguous;
//   - the connections it walks are computed in lib/links.js from stored edges,
//     never guessed;
//   - the model is handed those facts and only phrases them — the same
//     compute-in-code / model-only-narrates contract as every other tool here.
//
// The rule it must not break: an ambiguous reference is never silently resolved
// to one thing. If the graph can't tell which "thing with Priya" was meant, the
// answer says so rather than picking confidently and wrongly.
export async function queryConnections({ question }) {

  if (!question) {
    throw new Error("No question provided.");
  }

  const { anchors, candidates, unambiguous } = await resolveReference({ text: question });

  // Named nothing on file. Do not guess, and do not pretend the graph is empty
  // — say plainly that there is nothing recorded under that name, which is
  // itself the useful answer and often a nudge to capture it.
  if (!anchors.length) {
    return {
      success: true,
      message: "I don't have anyone or anything on file that matches that. Nothing is connected to it yet, so there's nothing to pull up.",
      data: { question, anchors: [], candidates: [] }
    };
  }

  // The facts, assembled in code from stored edges — never re-derived by the
  // model. Each candidate line names what it is, what it's called, and which
  // of the named anchors it hangs off.
  const anchorNames = anchors.map(a => a.name).join(" + ");

  const factLines = candidates.length
    ? candidates.map(c => {
        const amount = c.type === "transaction" && c.extra != null
          ? ` ($${Math.abs(Number(c.extra)).toFixed(2)})`
          : "";
        const via = c.via?.length ? ` — via ${c.via.join(", ")}` : "";
        const hop = c.distance > 1 ? " (indirect)" : "";
        return `- ${c.type}: ${String(c.label || "").slice(0, 80)}${amount}${via}${hop}`;
      }).join("\n")
    : "(nothing else is connected to it yet)";

  // Ambiguity here means the QUESTION named more than one distinct thing — two
  // different people/projects it could be about — not "this one thing has many
  // connections", which is the normal, useful case. Only hedge in the former.
  const ambiguityNote = anchors.length > 1
    ? `\nNOTE: the question named more than one thing (${anchorNames}). If those are separate subjects rather than one, keep them separate in the answer.`
    : "";

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [
      {
        role: "system",
        content: `You are Almanac, answering a question about how things in the
user's life are connected. Everything below was looked up from a real stored
graph of their data — it is fact, not a guess. Do not invent a connection that
is not listed, and do not compute or total anything that is not already written.

The question is about: ${anchorNames}

Connected to it (from the graph):
${factLines}${ambiguityNote}

ANSWER STYLE:
- Read aloud or shown on a phone. Plain text only — no markdown, no bullets.
- Two or three sentences. Lead with the answer.
- Blunt, nothing softened. If the honest answer is "not much is connected to
  that yet," say exactly that.
- Never imply you can see more than what is listed above.`
      },
      {
        role: "user",
        content: question
      }
    ]

  });

  const answer = response.choices[0].message.content;

  return {
    success: true,
    message: answer,
    data: {
      question,
      anchors,
      candidates,
      unambiguous
    }
  };

}
