-- PersonalOS — Practice tab (news/debate sparring + skill challenges)
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Two new tables, nothing existing touched.


-- Framed news stories, real headlines pulled from wire-style RSS sources
-- (BBC World, NPR World, WSJ World News — chosen for being live public feeds
-- from distinct editorial homes, not for a specific left/right label). The
-- framing itself (side_a/side_b) is generated grounded in the real headline
-- and description text, never invented from the model's own memory of "the
-- news" — that would violate the same anti-hallucination rule the rest of
-- this system runs on.
create table if not exists news_items (
  id            uuid primary key default gen_random_uuid(),
  headline      text not null,
  source        text not null,
  source_url    text not null unique,
  published_at  timestamptz,
  summary       text,   -- what happened, plainly
  context       text,   -- why this matters / how we got here — the missing-context primer
  tension       text,   -- the actual debatable question at the core of the story
  side_a        text,   -- a good-faith version of one side
  side_b        text,   -- a good-faith version of the other
  surfaced_at   timestamptz not null default now(),
  used_count    integer not null default 0
);

create index if not exists news_items_surfaced_idx on news_items (surfaced_at desc);


-- One row per practice attempt, either kind. Debate sessions carry a
-- news_item_id and which side the user argued; pitch sessions carry a
-- freeform topic and a single transcribed recording. transcript is an
-- append-only array of {role, message}; feedback is filled once, at
-- completion.
create table if not exists practice_sessions (
  id             uuid primary key default gen_random_uuid(),
  type           text not null,          -- 'debate' | 'pitch'
  news_item_id   uuid references news_items(id),
  user_side      text,                   -- 'side_a' | 'side_b', debate only
  topic          text,                   -- pitch only: what the pitch is about
  transcript     jsonb not null default '[]'::jsonb,
  feedback       jsonb,
  status         text not null default 'in_progress',   -- in_progress | completed
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists practice_sessions_status_idx on practice_sessions (status, created_at desc);
