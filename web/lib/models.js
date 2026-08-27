// The one place that names which model does what.
//
// Before this file the tiering policy documented in the architecture doc
// existed only as a convention that happened to be spelled the same way in
// twenty separate files. Nothing could be read to learn the policy, nothing
// could be changed to change it, and nothing failed if one file drifted — a
// provider deprecation meant a twenty-file sweep with no test to catch a miss.
//
// The tiers are chosen by *what the call is doing*, not by what it costs, so
// call sites read as intent ("this is a judgment call") rather than as a
// price. Cost follows from that, and re-tiering a whole class of work is a
// one-line edit here.

export const MODELS = {

  // Picking a tool and extracting arguments, plus the query tools that mostly
  // reformat what a database already returned. High frequency, low stakes,
  // structurally simple — this is most of the call volume in the system.
  ROUTER: "gpt-5.4-mini",

  // Same tier, named separately because the reason differs: extraction and
  // summarising rather than dispatch. Splitting these lets one move without
  // the other.
  EXTRACT: "gpt-5.4-mini",

  // Anything that forms an opinion, weighs context, or decides whether to
  // interrupt the user. Carries the full rich context and is the tier where a
  // wrong answer is actually visible to him.
  JUDGMENT: "gpt-5.6-terra",

  // The opening deep-thinking analysis only. Occasional, slow, and the one
  // place where depth is worth a real cost delta.
  DEEP: "gpt-5.6-sol",

  // Retrieval. ~$0.02/1M tokens, effectively free at this scale — the cost
  // problem retrieval solves is prompt bloat, not the embedding itself.
  EMBEDDING: "text-embedding-3-small",

  // Synthesized speech, ~$0.015 per spoken minute. The desk's streaming
  // exchange reads it from here; app/api/tts/route.js predates the registry
  // and still names it locally with its own fallback ladder.
  SPEECH: "gpt-4o-mini-tts"

};


// Do NOT use for routing: cannot use function tools in chat.completions except
// with reasoning_effort "none", and is ~2.5x slower. Kept here so the finding
// lives next to the registry instead of only in a handoff doc.
export const UNSUITABLE_FOR_ROUTING = ["gpt-5.6-luna"];


export default MODELS;
