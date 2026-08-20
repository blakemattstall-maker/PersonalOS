import Parser from "rss-parser";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";
import { mapWithConcurrency } from "../lib/async.js";
import { buildRichContext } from "../lib/context.js";


// The news feed — its own thing now, not feedstock for the debate tab.
//
// It used to be both, and that made it bad at each. Every story had to be
// forced into a two-sided frame to be usable for sparring, so anything without
// a clean binary argument was thrown away; and because the source list was
// world-affairs wires only, the result was six variations on foreign policy
// every morning. Debate moved to evergreen topics (tools/debateTopics.js),
// which frees this to be what it should have been: a reader.
//
// Three things it does that a raw feed doesn't:
//
//   1. Sources span US, world, business, technology and science, so the feed
//      is a spread rather than one beat.
//   2. Stories are scored against what this specific user actually has going
//      on — his memories, projects and intentions — and the feed is ordered by
//      that. If he only reads the top two, they should be the two that matter
//      to him.
//   3. Each story carries several honest viewpoints instead of exactly two.
//      Most real disagreements are not binary, and pretending otherwise is
//      its own kind of distortion.
//
// The anti-hallucination rule from the original version still governs
// everything: the news itself is always REAL, pulled from live feeds. A model
// asked "what happened today" answers from training data — stale or invented.
// Every summary here is grounded only in text actually fetched.

const SOURCES = [

  { name: "NPR News",        category: "us",         url: "https://feeds.npr.org/1001/rss.xml" },
  { name: "BBC US & Canada", category: "us",         url: "http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml" },

  { name: "BBC World",       category: "world",      url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "NPR World",       category: "world",      url: "https://feeds.npr.org/1004/rss.xml" },

  { name: "BBC Business",    category: "business",   url: "http://feeds.bbci.co.uk/news/business/rss.xml" },
  { name: "WSJ Markets",     category: "business",   url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },

  { name: "BBC Technology",  category: "technology", url: "http://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "Ars Technica",    category: "technology", url: "https://feeds.arstechnica.com/arstechnica/index" },

  { name: "NPR Science",     category: "science",    url: "https://feeds.npr.org/1007/rss.xml" }

];

// Pulled per source, before ranking. Deliberately more than we keep — the
// whole point of scoring is having something to choose between.
const ITEMS_PER_SOURCE = 5;

// Framed and stored per run. Framing is the expensive step, so it only ever
// runs on stories that already survived ranking.
const KEEP_PER_RUN = 7;


function missingColumn(error) {
  return ["42703", "PGRST204"].includes(error?.code)
    || /column .* does not exist/i.test(error?.message || "");
}


const parser = new Parser({ timeout: 15000 });


async function fetchCandidates() {

  const results = await Promise.allSettled(
    SOURCES.map(async source => {

      const feed = await parser.parseURL(source.url);

      return (feed.items || [])
        .slice(0, ITEMS_PER_SOURCE)
        .map(item => ({
          source: source.name,
          category: source.category,
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


// Phase one: cheap, single call over every headline at once.
//
// Framing a story properly costs a full judgment-tier call, and running that
// across 45 candidates to then discard 38 of them is most of the cost of this
// feature for none of the value. Ranking first — on headlines alone, with a
// small model — means the expensive step only ever touches stories that
// already earned it.
async function rankAgainstUser(candidates, userContext) {

  const list = candidates
    .map((c, i) => `${i}. [${c.category}] ${c.headline}`)
    .join("\n");

  const response = await openai.chat.completions.create({

    model: MODELS.EXTRACT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Score today's news headlines for one specific reader.

What you know about him:
${userContext || "(nothing saved yet — score on general significance alone)"}

Headlines:
${list}

For each, give a 0-10 score for how much THIS reader should care:
  8-10 — touches something he's actually working on, deciding, or has told us he cares about
  5-7  — genuinely consequential news any informed adult should know happened
  2-4  — real but minor, or narrow to a place/industry he has no connection to
  0-1  — celebrity noise, sports results, incremental coverage of a story with no development

Do not inflate scores to be encouraging, and do not manufacture a personal
connection that isn't there — most stories are a 5 or 6 and that is the correct
answer. Reserve 8+ for a real, nameable link to his actual life.

Prefer a spread of categories in the top scores over five versions of the same
story. If several headlines cover one event, score the fullest one and drop the
rest to 2.

Return ONLY JSON:
{ "scores": [{ "i": 0, "score": 7, "why": "one short clause, or null if purely general significance" }] }`
      }

    ]

  });

  const parsed = JSON.parse(response.choices[0].message.content);

  const byIndex = new Map();

  for (const s of parsed.scores || []) {
    if (typeof s.i === "number") byIndex.set(s.i, s);
  }

  return candidates
    .map((c, i) => ({
      ...c,
      relevance_score: byIndex.get(i)?.score ?? 5,
      relevance: byIndex.get(i)?.why || null
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score);

}


// Phase two: the real work, on the survivors only.
async function frame(candidate, userContext) {

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Prepare a real news story for someone who wants to follow the
news properly but has found the barrier — missing context, not knowing why
something matters — to be what stops him.

Ground everything ONLY in the real headline and description below. Never add
facts, numbers, or events that aren't in this text. If the description is thin,
keep your summary thin too rather than inventing detail to fill space. You are
not being graded on length.

Headline: "${candidate.headline}"
Source: ${candidate.source}
Description: "${candidate.description || "(no further detail available)"}"

${userContext ? `About the reader, for the "why this matters to him" line only:\n${userContext}` : ""}

Produce:
1. summary — what actually happened, neutrally, 1-2 sentences.
2. context — the missing background: how we got here, what came before this,
   what a reader needs to not feel lost. 2-3 sentences, plain language, no
   jargon left unexplained.
3. viewpoints — 2 to 4 genuinely different honest readings of this story, each
   as { "label": "...", "take": "..." }. The label names WHOSE reading it is
   or what it prioritises ("Free-speech advocates", "Central bankers",
   "Workers in the sector") — not "Side A". The take is 1-2 sentences of the
   strongest honest version of that reading.
   Give the number the story actually has. A genuinely one-sided story — a
   natural disaster, a discovery, a death — gets ONE viewpoint, or none.
   Manufacturing a controversy to hit a quota is the specific failure to avoid.
4. why_it_matters — one blunt sentence on why this is worth his attention,
   personal if there's a real link to him, general if there isn't. Never invent
   a connection to his life.

Return ONLY JSON:
{
  "summary": "...",
  "context": "...",
  "viewpoints": [{ "label": "...", "take": "..." }],
  "why_it_matters": "..."
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


// The new columns land in one migration. Until it's run, the insert has to
// drop them or PostgREST rejects the whole row for containing keys it doesn't
// recognise — the same trap that would have broken create_event when the
// people migration was pending. Retrying without them keeps the feed working,
// just flatter, instead of failing outright.
async function insertItem(row) {

  const { error } = await supabase.from("news_items").insert([row]);

  if (!error) return { ok: true, degraded: false };

  if (error.code === "23505") return { ok: false, duplicate: true };

  if (missingColumn(error)) {

    const { viewpoints, relevance, category, relevance_score, ...legacy } = row;

    const { error: retryError } = await supabase.from("news_items").insert([legacy]);

    if (!retryError) return { ok: true, degraded: true };
    if (retryError.code === "23505") return { ok: false, duplicate: true };

    throw new Error(retryError.message);

  }

  throw new Error(error.message);

}


export async function syncNewsDigest() {

  const { candidates, failed } = await fetchCandidates();

  if (candidates.length === 0) {
    return { success: false, error: "No sources returned anything.", failedSources: failed };
  }

  const seen = await alreadySeen(candidates.map(c => c.source_url));
  const fresh = candidates.filter(c => !seen.has(c.source_url));

  if (fresh.length === 0) {
    return {
      success: true,
      message: "Nothing new since the last run.",
      data: { stored: 0, candidates: candidates.length, failedSources: failed }
    };
  }

  // One context build for the whole run, not one per story.
  const context = await buildRichContext({ query: "current events and news" }).catch(() => null);

  // memoriesText, not memories: the object interpolated here as the literal
  // string "[object Object]" for weeks — news ranking ran on bio alone while
  // claiming to know his memories.
  const userContext = context && [context.bio, context.memoriesText].filter(Boolean).join("\n\n");

  const ranked = await rankAgainstUser(fresh, userContext).catch(() => fresh);

  const shortlist = ranked.slice(0, KEEP_PER_RUN);

  let stored = 0;
  let degraded = false;

  const errors = [];

  const results = await mapWithConcurrency(shortlist, async candidate => {

    try {

      const framed = await frame(candidate, userContext);

      const outcome = await insertItem({
        headline: candidate.headline,
        source: candidate.source,
        source_url: candidate.source_url,
        published_at: candidate.published_at,
        category: candidate.category,
        summary: framed.summary,
        context: framed.context,
        viewpoints: framed.viewpoints || [],
        relevance: framed.why_it_matters || candidate.relevance,
        relevance_score: candidate.relevance_score
      });

      return outcome;

    } catch (error) {
      errors.push({ headline: candidate.headline, error: error.message });
      return null;
    }

  }, 3);

  for (const r of results) {
    if (r?.ok) stored += 1;
    if (r?.degraded) degraded = true;
  }

  return {
    success: true,
    message: `Stored ${stored} new stor${stored === 1 ? "y" : "ies"} from ${candidates.length} candidate(s).`,
    data: {
      stored,
      candidates: candidates.length,
      considered: fresh.length,
      errors,
      failedSources: failed,
      degraded,
      ...(degraded ? { needsMigration: "docs/schema-practice-split.sql" } : {})
    }
  };

}


// Ordered by relevance to him first, recency second — so the top of the feed
// is the part worth reading if he reads nothing else. Falls back to pure
// recency when the migration hasn't run and every score is null.
export async function getNewsFeed({ limit = 12, hours = 48 } = {}) {

  const since = new Date();
  since.setHours(since.getHours() - hours);

  const { data, error } = await supabase
    .from("news_items")
    .select("*")
    .gte("surfaced_at", since.toISOString())
    .order("surfaced_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const items = data || [];

  return [...items].sort((a, b) => {

    const scoreDiff = (b.relevance_score ?? 5) - (a.relevance_score ?? 5);

    if (scoreDiff !== 0) return scoreDiff;

    return new Date(b.surfaced_at) - new Date(a.surfaced_at);

  });

}


// Kept under its old name because the Shortcut and any cached client may still
// call it. Same data, narrower window.
export async function getTodaysDigest({ limit = 6 } = {}) {
  return getNewsFeed({ limit, hours: 36 });
}


// "I don't want this one" — permanent, not a snooze. A refresh only ever adds
// candidates that haven't been seen before (deduped on source_url), so
// deleting a story is what actually frees its slot back up.
export async function deleteNewsItem(id) {

  if (!id) throw new Error("deleteNewsItem requires an id.");

  // practice_sessions.news_item_id has no ON DELETE clause, so a story already
  // debated would otherwise block deletion with a foreign-key error. The
  // session and its transcript are worth keeping regardless of whether the
  // source story is still around — just detach the reference.
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
