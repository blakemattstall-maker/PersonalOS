-- PersonalOS — splitting Practice into "debate" and "news", plus explainer pitches
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- WHY THIS EXISTS
--
-- The Practice tab's debate mode was fed by the same daily news digest that
-- was meant to be a news reader. That coupling made both halves worse:
--
--   * Debate topics inherited whatever the wire feeds happened to run that
--     morning, which is mostly foreign-affairs reporting. Arguing those well
--     requires research first — you can't spar about a Kashmir security
--     crackdown from general knowledge — so the barrier to *starting* was
--     high on exactly the feature meant to lower it.
--
--   * The news half could never become a real reader, because every story had
--     to be forced into a two-sided debate frame to be useful, and stories
--     with no genuine tension were thrown away entirely.
--
-- So they split. Debate gets evergreen, genuinely contested topics that any
-- informed adult already holds an opinion about. News becomes its own feed,
-- personalised, with multiple viewpoints per story instead of two.


-- ---------------------------------------------------------------------------
-- 1. Evergreen debate topics
-- ---------------------------------------------------------------------------
--
-- These are NOT news. They're the standing disagreements — abortion, speech,
-- inequality, religion — that don't expire and don't need a briefing to argue.
-- The seed list lives in tools/debateTopics.js; the framing (context/tension/
-- sides) is generated once per topic and then reused, because unlike a news
-- story the underlying question doesn't move.
--
-- `slug` is the dedupe key against the seed list, so re-running the generator
-- tops up missing topics instead of duplicating the ones already framed.
create table if not exists debate_topics (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  category      text not null,          -- 'ethics' | 'economics' | 'politics' | 'religion' | 'technology' | 'society'
  context       text,                   -- the background needed to argue it honestly
  tension       text,                   -- the actual question, phrased so both answers are defensible
  side_a        text,                   -- strongest good-faith version of one position
  side_b        text,                   -- strongest good-faith version of the other
  difficulty    text default 'common',  -- 'common' (general knowledge) | 'informed' (needs some reading)
  created_at    timestamptz not null default now(),
  used_count    integer not null default 0,
  retired       boolean not null default false
);

create index if not exists debate_topics_active_idx
  on debate_topics (retired, used_count, created_at desc);


-- ---------------------------------------------------------------------------
-- 2. practice_sessions can now point at a debate topic, not just a news item
-- ---------------------------------------------------------------------------
--
-- news_item_id stays for the sessions already recorded against it — dropping
-- it would erase real history. New debate sessions fill debate_topic_id
-- instead, and the code reads whichever is present.
alter table practice_sessions
  add column if not exists debate_topic_id uuid references debate_topics(id);

-- Pitch sessions now come in two flavours. 'pitch' is the original: you're
-- selling something and get graded on persuasion. 'explainer' is the thought
-- exercise — a generated topic you research briefly and then teach back,
-- graded on whether you actually understood it rather than whether you sold
-- it. Same recorder, same transcription, different rubric.
alter table practice_sessions
  add column if not exists mode text;

alter table practice_sessions
  add column if not exists prompt text;   -- the generated "explain X as if Y" brief


-- ---------------------------------------------------------------------------
-- 3. news_items becomes a real reader, not a debate feedstock
-- ---------------------------------------------------------------------------
--
-- tension/side_a/side_b stay (existing rows still have them, and they're
-- harmless), but the feed no longer depends on them — a story with no
-- two-sided argument is now worth keeping and reading, which it wasn't
-- before.
--
-- viewpoints replaces the forced binary: an array of
--   { "label": "...", "take": "..." }
-- so a story can carry three or five honest readings instead of exactly two.
alter table news_items
  add column if not exists viewpoints jsonb not null default '[]'::jsonb;

-- Why THIS story matters to THIS user, written against his actual memories,
-- projects and intentions. Null when nothing in his context connects to it —
-- an honest "this is just generally significant" rather than a manufactured
-- personal angle.
alter table news_items
  add column if not exists relevance text;

-- 'us' | 'world' | 'business' | 'technology' | 'science' | 'politics'
-- Lets the feed show a spread instead of six variations on one beat, which
-- is what the world-only source list produced.
alter table news_items
  add column if not exists category text;

-- 0-10, how much this particular user should care, scored against his
-- context. Drives ordering in the feed so the top of the page is the part
-- worth reading if he only reads the top.
alter table news_items
  add column if not exists relevance_score integer;

create index if not exists news_items_feed_idx
  on news_items (surfaced_at desc, relevance_score desc);
