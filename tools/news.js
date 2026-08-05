import Parser from "rss-parser";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";


// The daily news digest behind the Practice tab's debate mode.
//
// The whole point is lowering the effort barrier to following world affairs,
// which means the actual news has to be REAL — pulled from live wire-style
// feeds, not asked from the model's own memory of "what's in the news." An
// LLM answering "what happened today" from training data is either stale or
// invented, and this system's standing rule (never let a model state a figure
// or fact it didn't actually look up) applies here just as much as it does to
// finances or task counts.
//
// Sources are chosen for being live, free, public RSS from three separate
// editorial homes (a UK public broadcaster, US public radio, a US business
// paper) — not for a specific left/right label. Rather than trusting outlet
// framing directly (which means silently picking a "these are the two sides"
// mapping in code — itself an editorial act this system has no business
// making unilaterally), the model generates its own good-faith framing of the
// actual tension in each story, grounded in the real text pulled from the
// feed.
const SOURCES = [
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
  { name: "WSJ World News", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" }
];

// Per source, per run. Keeps the digest to a handful of substantial stories a
// day rather than a firehose — matches the same "silence is usually correct,
// only surface what's genuinely worth the effort" instinct as the observer.
const ITEMS_PER_SOURCE = 3;
const MAX_ITEMS_PER_DAY = 6;

const parser = new Parser({ timeout: 15000 });


async function fetchCandidates() {

  const results = await Promise.allSettled(
    SOURCES.map(async source => {

      const feed = await parser.parseURL(source.url);

      return (feed.items || [])
        .slice(0, ITEMS_PER_SOURCE)
        .map(item => ({
          source: source.name,
          headline: item.title?.trim(),
          source_url: item.link,
          published_at: item.isoDate || item.pubDate || null,
          // contentSnippet strips HTML; raw content can carry tags/entities
          // that would otherwise leak into the prompt verbatim.
          description: (item.contentSnippet || item.content || "").slice(0, 1500)
        }));

    })
  );

  const candidates = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value)
    .filter(c => c.headline && c.source_url);

  const failed = results
    .map((r, i) => (r.status === "rejected" ? SOURCES[i].name : null))
    .filter(Boolean);

  return { candidates, failed };

}


async function alreadySeen(urls) {

  if (urls.length === 0) return new Set();

  const { data } = await supabase
    .from("news_items")
    .select("source_url")
    .in("source_url", urls);

  return new Set((data || []).map(r => r.source_url));

}


async function frame(candidate) {

  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `You are preparing a real news story for someone who wants to
understand world affairs and practice debating them, but has always found the
barrier to entry — missing context, not knowing "why this matters" — to be
what stops him.

Ground everything ONLY in the real headline and description below. Never add
facts, numbers, or events that aren't in this text — if the description is
thin, keep your summary and context thin too rather than inventing detail.

Headline: "${candidate.headline}"
Source: ${candidate.source}
Description: "${candidate.description || "(no further detail available)"}"

Produce:
1. A neutral one-to-two sentence summary of what actually happened.
2. A short "why this matters / how we got here" primer — the missing
   background someone would need to not feel lost, in plain language, 2-3
   sentences.
3. The real, specific tension or disagreement at the core of this story —
   phrased as a genuine question people disagree on, not a vague "there are
   two sides" gesture.
4. Two good-faith framings of that tension — side_a and side_b — each the
   strongest honest version of that position, NOT a strawman. These are
   positions a genuinely thoughtful person could hold, not caricatures.

If this story has no real debatable tension (a natural disaster, a sports
result, an obituary), set "hasDebate" to false and leave side_a/side_b empty —
don't force a manufactured controversy onto a story that doesn't have one.

Return ONLY JSON:
{
  "hasDebate": boolean,
  "summary": "...",
  "context": "...",
  "tension": "...",
  "side_a": "...",
  "side_b": "..."
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


export async function syncNewsDigest() {

  const { candidates, failed } = await fetchCandidates();

  if (candidates.length === 0) {
    return { success: false, error: "No sources returned anything.", failedSources: failed };
  }

  const seen = await alreadySeen(candidates.map(c => c.source_url));
  const fresh = candidates.filter(c => !seen.has(c.source_url));

  let stored = 0;
  const errors = [];

  for (const candidate of fresh) {

    if (stored >= MAX_ITEMS_PER_DAY) break;

    try {

      const framed = await frame(candidate);

      if (process.env.DEBUG_NEWS_FRAMING) console.log("FRAMED:", candidate.headline, JSON.stringify(framed, null, 2));

      if (!framed.hasDebate) continue;

      const { error } = await supabase.from("news_items").insert([{
        headline: candidate.headline,
        source: candidate.source,
        source_url: candidate.source_url,
        published_at: candidate.published_at,
        summary: framed.summary,
        context: framed.context,
        tension: framed.tension,
        side_a: framed.side_a,
        side_b: framed.side_b
      }]);

      // A duplicate source_url from a near-simultaneous run is a harmless
      // race, not a real failure — the unique constraint is what's supposed
      // to catch it.
      if (error && error.code !== "23505") throw new Error(error.message);

      if (!error) stored += 1;

    } catch (error) {
      errors.push({ headline: candidate.headline, error: error.message });
    }

  }

  return {
    success: true,
    message: `Synced ${stored} new framed stor${stored === 1 ? "y" : "ies"} from ${candidates.length} candidate(s).`,
    data: { stored, candidates: candidates.length, skippedNoDebate: fresh.length - stored - errors.length, errors, failedSources: failed }
  };

}


export async function getTodaysDigest({ limit = 6 } = {}) {

  const since = new Date();
  since.setHours(since.getHours() - 36);

  const { data, error } = await supabase
    .from("news_items")
    .select("*")
    .gte("surfaced_at", since.toISOString())
    .order("surfaced_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return data || [];

}


// "I don't want this one" — permanent, not a snooze. A refresh only ever adds
// candidates that haven't been seen before (deduped on source_url), so
// deleting a story is what actually frees its slot back up; leaving it would
// mean the digest just grows unbounded every day instead of staying a
// deliberately small, current list.
export async function deleteNewsItem(id) {

  if (!id) throw new Error("deleteNewsItem requires an id.");

  // practice_sessions.news_item_id has no ON DELETE clause, so a story
  // already debated would otherwise block deletion with a foreign-key error.
  // The session and its transcript/feedback are worth keeping regardless of
  // whether the source story is still around — just detach the reference.
  await supabase
    .from("practice_sessions")
    .update({ news_item_id: null })
    .eq("news_item_id", id);

  const { error } = await supabase
    .from("news_items")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  return { success: true };

}
