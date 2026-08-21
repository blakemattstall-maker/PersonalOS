-- Almanac — internship / job posting monitor
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query). Two tables, nothing existing is touched.
--
-- What breaks without it: the Jobs half of the Career tab and the
-- /api/cron/checkJobs poller. Everything else is unaffected.
--
-- The design in one line: `job_sources` is the watchlist (one row per company
-- board), `job_postings` is everything ever seen, and "have I already told him
-- about this?" is a column rather than a guess.

create table if not exists job_sources (

  id          bigint generated always as identity primary key,

  company     text not null,

  -- 'greenhouse' | 'lever' | 'ashby'. Each has a public, unauthenticated JSON
  -- board endpoint; the token is the company's slug on that ATS.
  ats         text not null,
  token       text not null,

  -- Why this company is on the list, in the user's terms — surfaced in the UI
  -- so a watchlist of 80 names is still legible a month from now.
  category    text,

  active      boolean not null default true,

  -- Polling health. A board that starts 404ing (company changed ATS, renamed
  -- its slug) must be visible as broken rather than silently returning zero
  -- postings forever — the exact failure mode this codebase keeps relearning.
  last_checked_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  consecutive_failures integer not null default 0,

  created_at  timestamptz not null default now(),

  unique (ats, token)

);


create table if not exists job_postings (

  id          bigint generated always as identity primary key,

  -- The ATS's own id for the posting, scoped by source. This pair is what
  -- makes the poller idempotent: seeing the same posting on the next run is a
  -- no-op, not a second notification.
  source_id   bigint references job_sources(id) on delete cascade,
  external_id text not null,

  company     text not null,
  title       text not null,
  location    text,
  url         text not null,

  -- When the ATS says it went live. Nullable: Lever gives a timestamp,
  -- Greenhouse gives an updated_at, Ashby varies. first_seen_at is ours and is
  -- never null, so "how fast did we catch it" is always answerable.
  posted_at     timestamptz,
  first_seen_at timestamptz not null default now(),

  -- Set when the posting stops appearing on its board.
  closed_at   timestamptz,

  -- Scoring, computed in code (never by a model): does this look like an
  -- internship, and does it match the user's fields?
  is_internship boolean not null default false,
  match_score   integer not null default 0,
  matched_terms text[],

  -- Notification state. A posting is notified at most once, ever.
  notified_at timestamptz,

  -- 'new' | 'saved' | 'applied' | 'dismissed' — the user's own triage.
  status      text not null default 'new',

  raw         jsonb,

  created_at  timestamptz not null default now(),

  unique (source_id, external_id)

);


create index if not exists job_postings_seen_idx     on job_postings (first_seen_at desc);
create index if not exists job_postings_notified_idx on job_postings (notified_at);
create index if not exists job_postings_status_idx   on job_postings (status, first_seen_at desc);


-- RLS on, no policies: every legitimate read goes through the service key,
-- same posture as every other table here (see the Aug 19 sweep).
alter table job_sources  enable row level security;
alter table job_postings enable row level security;
