import openai from "./openai.js";


// text-embedding-3-small: ~$0.02 per 1M tokens, 1536 dimensions. A memory or a
// query is a handful of tokens, so this is effectively free at this system's
// scale — the cost problem retrieval solves isn't embedding generation, it's
// that a blanket top-N dump grows every prompt as the memory count grows.
// Retrieval keeps each call's slice small and RELEVANT regardless of how large
// the total corpus gets.
const MODEL = "text-embedding-3-small";


export async function embed(text) {

  const input = (text || "").trim();

  if (!input) return null;

  const response = await openai.embeddings.create({
    model: MODEL,
    input
  });

  return response.data[0].embedding;

}
