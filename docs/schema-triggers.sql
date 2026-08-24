-- Almanac — triggers: the app acting on its own, at the moment it matters
--
-- Run once in the Supabase SQL editor. Two new tables and one new column on
-- places; nothing existing is touched.
--
-- What breaks without it: nothing. Every trigger path checks for the table and
-- goes quiet if it is missing, exactly like the jobs tables did.
--
--
-- WHY THIS EXISTS
--
-- The app knew a standing instruction — "around any barbell events, remind me
-- beforehand to capture media and stats" was sitting in memories — and the best
-- it could do with it was write a nudge telling its owner to go and add a
-- calendar reminder himself. That is the assistant asking the person to do the
-- assistant's job.
--
-- A calendar event is also the wrong artefact. An event is something you have
-- to remember to look at. What is actually wanted is a buzz at 4:30 on the day,
-- or better, a buzz when you WALK INTO THE GYM — the app already knows where
-- its owner is, to a hundred metres, every ten minutes.
--
-- So: a trigger is a standing rule of the form WHEN this happens, SAY this, and
-- optionally ASK for something back and keep the answers as a series. It is
-- deliberately not about workouts, or barbell meetings, or any other single
-- case — the same three columns serve "practise muscle-up negatives when I get
-- to the gym", "film something before the 5pm meeting", and anything else that
-- has a moment and a message.


create table if not exists triggers (

  id            bigint generated always as identity primary key,

  -- place_arrival | before_event | time_of_day
  kind          text not null,

  -- Shown in the app and in the reply that confirms it was created. Written
  -- for a person: "At the gym — muscle-up practice".
  label         text not null,


  -- ── place_arrival ──────────────────────────────────────────────────────
  place_id      uuid references places(id) on delete cascade,

  -- How long he has to have been there. 0 fires the moment he arrives, which
  -- is right for a dining hall and wrong for a gym: the gym is a hundred
  -- metres from a path he walks to class, and a trigger that fires every time
  -- he passes it is a trigger he turns off. Ten minutes means he is actually
  -- there.
  dwell_minutes integer not null default 0,


  -- ── before_event ───────────────────────────────────────────────────────
  -- Matched case-insensitively as a substring of the calendar event's title,
  -- so "barbell" catches "Redbird Barbell Club Meeting" and every rename of it
  -- that keeps the word.
  event_match   text,
  lead_minutes  integer not null default 30,


  -- ── time_of_day ────────────────────────────────────────────────────────
  at_time       text,                      -- 'HH:MM', the owner's local clock
  days_of_week  integer[],                 -- 1=Mon .. 7=Sun; null means any day


  -- ── what it does ───────────────────────────────────────────────────────
  message       text not null,

  -- The question to put on the card, or null for a trigger that only tells.
  -- This is what turns a reminder into a record: "How many did you get?"
  asks          text,

  -- Free-text label for the series the answers form, e.g. 'muscle_up'. Only
  -- meaningful when `asks` is set.
  log_kind      text,


  -- What this serves, so the graph and the brief can see why it exists.
  -- goal | project | intention | memory | person
  subject_type  text,
  subject_id    text,


  -- ── firing ─────────────────────────────────────────────────────────────
  -- These two are a HEARTBEAT, not the lock. The lock is trigger_fires below.
  --
  -- A cooldown was the obvious design and it is wrong in both directions for a
  -- calendar trigger: two events matching the same word inside one cooldown
  -- window (a 5pm and a 6:30pm "Gym" block) would silently drop the second,
  -- while a cooldown short enough to allow both would let one event fire twice
  -- across two cron ticks.
  cooldown_minutes integer not null default 360,
  last_fired_at    timestamptz,
  fire_count       integer not null default 0,

  active        boolean not null default true,

  -- 'capture' when it came out of something he said, 'manual' from the app.
  -- Worth keeping: it is the honest measure of whether the extraction pass is
  -- actually earning its model call.
  source        text,

  created_at    timestamptz not null default now()

);

create index if not exists triggers_place_idx on triggers (place_id) where active;
create index if not exists triggers_kind_idx on triggers (kind, active);


-- Where a trigger's arrival is measured from.
--
-- last_seen_at moves every ten minutes while he is standing in the room, so it
-- cannot answer "how long has he been here" — that needs the moment the visit
-- began, which nothing recorded until now.
alter table places add column if not exists arrived_at timestamptz;


-- The lock, and it is a unique index rather than a timestamp comparison.
--
-- Every occasion a trigger could fire has a name that is stable and unique:
--
--   place_arrival  place:<place_id>:<arrived_at>   — one firing per VISIT, so
--                  walking back past the gym tomorrow is a different key and a
--                  cooldown never has to be guessed at
--   before_event   event:<calendar instance id>    — Google expands recurring
--                  events with singleEvents:true, so every Wednesday's meeting
--                  is its own id and its own firing
--   time_of_day    time:<local date>:<HH:MM>
--
-- Claiming is then an INSERT, and the unique index decides. Two concurrent runs
-- race, one gets a 23505, and exactly one push goes out. That is a real lock,
-- unlike a read-then-write on a timestamp, which two runs can both pass.
create table if not exists trigger_fires (

  id         bigint generated always as identity primary key,

  trigger_id bigint not null references triggers(id) on delete cascade,

  fire_key   text not null,

  fired_at   timestamptz not null default now()

);

create unique index if not exists trigger_fires_once on trigger_fires (trigger_id, fire_key);

-- Nothing reads rows older than a few days; this keeps the lock table from
-- growing without bound.
create index if not exists trigger_fires_age_idx on trigger_fires (fired_at desc);


-- The series. One row per answer to a trigger that asked something.
--
-- `numbers` is parsed OUT of the text in code, never by a model: "5 negatives
-- and 2 assisted" becomes {"negatives": 5, "assisted": 2} by regex, so a chart
-- of progress over a season is arithmetic on real integers rather than a model
-- being asked to remember what it said last week.
create table if not exists trigger_logs (

  id          bigint generated always as identity primary key,

  trigger_id  bigint not null references triggers(id) on delete cascade,

  -- The card this answered, kept so a log can be traced back to the exact
  -- question that produced it.
  prompt_id   uuid,

  response    text,
  numbers     jsonb,

  occurred_at timestamptz not null default now()

);

create index if not exists trigger_logs_trigger_idx on trigger_logs (trigger_id, occurred_at desc);


alter table triggers enable row level security;
alter table trigger_fires enable row level security;
alter table trigger_logs enable row level security;
