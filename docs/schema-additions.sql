-- PersonalOS — schema additions for proactive mode
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It only creates new tables; nothing existing is touched or dropped.
--
-- Why this can't be done from code: Supabase's REST layer (PostgREST) can read
-- and write rows but cannot create tables, so every schema change has to be run
-- by hand. This is the one thing blocking the proactive features.


-- 1. WEB PUSH -----------------------------------------------------------------
-- Where to deliver a notification. One row per device that grants permission.
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);


-- 2. PLACES -------------------------------------------------------------------
-- A location the user visits repeatedly. Created automatically once a cluster of
-- points repeats; label/category/notes stay null until the user names it, which
-- is what makes "you're near the gym" possible rather than "you're at 40.51,-88.99".
create table if not exists places (
  id            uuid primary key default gen_random_uuid(),
  label         text,
  category      text,
  notes         text,
  latitude      double precision not null,
  longitude     double precision not null,
  radius_meters integer not null default 120,
  visit_count   integer not null default 1,
  needs_label   boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);


-- 3. LOCATION POINTS ----------------------------------------------------------
-- Raw GPS. Downsampled by a retention job rather than kept forever: at a point
-- every 15 minutes this is ~35k rows a year, which the free tier handles easily,
-- but there is no reason to keep minute-level history from eight months ago.
create table if not exists location_points (
  id           bigserial primary key,
  recorded_at  timestamptz not null,
  latitude     double precision not null,
  longitude    double precision not null,
  accuracy_m   double precision,
  speed_mps    double precision,
  battery      double precision,
  place_id     uuid references places(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists location_points_recorded_at_idx
  on location_points (recorded_at desc);

create index if not exists location_points_place_idx
  on location_points (place_id);


-- 4. DAILY METRICS ------------------------------------------------------------
-- One row per day. This is the substrate for every "when X, you also Y" claim:
-- correlation needs history at a comparable grain, and live reads can't provide
-- it. Nulls are meaningful — they mean "not measured that day", not zero.
create table if not exists daily_metrics (
  day                   date primary key,
  spend_total           numeric,
  income_total          numeric,
  transaction_count     integer,
  tasks_completed       integer,
  tasks_completed_late  integer,
  tasks_overdue         integer,
  calendar_busy_minutes integer,
  weight                numeric,
  places_visited        integer,
  minutes_at_gym        integer,
  computed_at           timestamptz not null default now()
);


-- 5. PROMPTS ------------------------------------------------------------------
-- Things the app wants to say to the user, or ask them, on its own initiative.
-- Generalises the existing nudges table beyond intentions: an unlabelled place,
-- a spending observation, a challenge, a large-transaction alert. `status`
-- tracks whether it has been delivered and whether it still needs an answer.
create table if not exists prompts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  title        text,
  body         text not null,
  payload      jsonb,
  status       text not null default 'pending',
  answer       text,
  pushed_at    timestamptz,
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);

create index if not exists prompts_status_idx on prompts (status, created_at desc);
