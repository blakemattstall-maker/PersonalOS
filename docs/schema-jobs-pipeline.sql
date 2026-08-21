-- Almanac — application outcomes, and the pipeline they form
--
-- Run once in the Supabase SQL editor. One new table plus two columns on
-- job_postings; nothing existing is touched.
--
-- What breaks without it: the Pipeline page and every stage button. The feed
-- and the alerts keep working exactly as they do now.
--
--
-- WHY A TABLE OF EVENTS RATHER THAN A STATUS COLUMN
--
-- A flow chart is made of TRANSITIONS, not states. "84 rejections" is a number
-- you can get from a status column; "of the 8 that reached a first round, 2
-- went to a second round and 1 became an offer" is only answerable if the path
-- each application took was recorded. A status column overwrites that path
-- every time it changes.
--
-- So each stage change is a row, and the current stage is simply the newest
-- one. The flows between stages fall straight out of consecutive pairs.

create table if not exists job_events (

  id          bigint generated always as identity primary key,

  posting_id  bigint not null references job_postings(id) on delete cascade,

  -- applied | first_round | second_round | final_round | offer
  -- rejected | withdrawn
  --
  -- "ghosted" is deliberately NOT a stage here. Nobody sends a rejection they
  -- never wrote, and Blake is not going to hand-mark a hundred silences — it
  -- is derived in code from an application that has heard nothing for weeks.
  stage       text not null,

  -- Free text for the ones worth remembering: who interviewed, what was asked.
  note        text,

  -- When it actually happened, which is not always when it was entered.
  occurred_at timestamptz not null default now(),

  created_at  timestamptz not null default now()

);

create index if not exists job_events_posting_idx on job_events (posting_id, occurred_at desc);
create index if not exists job_events_stage_idx on job_events (stage, occurred_at desc);


-- The current stage, denormalised so the feed can filter and sort on it
-- without joining. job_events remains the source of truth; this is a cache the
-- writer keeps in step.
alter table job_postings add column if not exists stage text;

-- When the most recent stage change happened — what "no word in three weeks"
-- is measured from.
alter table job_postings add column if not exists stage_at timestamptz;

create index if not exists job_postings_stage_idx on job_postings (stage, stage_at desc);


alter table job_events enable row level security;
