import OpenAI from "openai";


// Lazily constructed, for the same reason lib/supabase.js is.
//
// `new OpenAI()` throws immediately when OPENAI_API_KEY is unset, at MODULE
// LOAD — so merely importing anything that transitively touches this file blew
// up without a key. That made pure, offline logic untestable: tests/dedupe.js
// only wanted the normalise() text helper, but importing lib/dedupe.js
// constructed an API client and threw before a single assertion ran.
//
// The proxy defers construction to first property access, so importing is free
// and only actually calling the API needs credentials. Behaviour at runtime is
// unchanged — the client is still a singleton, still built once.

let client = null;


export function getOpenAI() {

  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return client;

}


// Reset between tests, or after an env change in a long-lived process.
export function resetOpenAIClient() {
  client = null;
}


// Default export keeps the `openai.chat.completions.create(...)` shape every
// call site already uses, so nothing else changes.
const openai = new Proxy({}, {

  get(_target, prop) {

    const value = getOpenAI()[prop];

    return typeof value === "function" ? value.bind(getOpenAI()) : value;

  }

});


export default openai;
