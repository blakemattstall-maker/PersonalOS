-- PersonalOS — The Fund
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- WHAT THIS IS
--
-- A paper portfolio with a personality, funded by things the user actually
-- does or fails to do. Skip the gym, ten virtual dollars land in the fund and
-- an eccentric fund manager does something with them. Every morning it files a
-- dispatch about what it did and why.
--
-- Positions are PAPER. Prices are real, the P/L is real arithmetic on real
-- quotes, and nothing is ever bought or sold anywhere. The app decides; if the
-- user likes a call he places it himself. That is not a limitation working
-- around a missing feature — an automated system placing real orders off the
-- back of "did Blake go to the gym" is a genuinely bad idea, and the entertaining
-- half of this survives entirely without it.
--
-- The point is NOT to train anyone. It's a side plot with its own opinions that
-- turns a missed workout into a story rather than a scolding.


-- ---------------------------------------------------------------------------
-- 1. The account
-- ---------------------------------------------------------------------------
--
-- Single row. cash is uninvested virtual capital; total_deposited is every
-- dollar the user's behaviour has ever put in, which is what makes
-- "up 4% on money you earned by oversleeping" computable.
--
-- The manager is stored rather than hardcoded so it can have a name, a thesis
-- and a voice that drift over time. A fund manager whose worldview never
-- changes is a lookup table with adjectives.
create table if not exists fund_account (
  id                uuid primary key default gen_random_uuid(),
  cash              numeric not null default 0,
  total_deposited   numeric not null default 0,
  manager_name      text,
  manager_voice     text,     -- how it writes: cadence, tics, what it's smug about
  thesis            text,     -- the current, deliberately non-mainstream worldview
  thesis_set_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 2. Positions
-- ---------------------------------------------------------------------------
--
-- One row per symbol held. avg_cost is maintained on buy so unrealised P/L is
-- arithmetic rather than a replay of the whole event log on every page load.
create table if not exists fund_positions (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null unique,
  shares        numeric not null,
  avg_cost      numeric not null,
  thesis        text,          -- why this was bought, in the manager's words
  opened_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. Every event, forever
-- ---------------------------------------------------------------------------
--
-- Append-only. Deposits carry what triggered them, so the fund can say "this
-- position exists because you skipped the gym twice in March" — which is the
-- entire joke and needs the causal link preserved, not just a balance.
--
-- trigger_key also makes deposits idempotent: the daily evaluation is safe to
-- run twice without charging the same missed workout twice.
create table if not exists fund_events (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,          -- 'deposit' | 'buy' | 'sell'
  symbol        text,                   -- null for deposits
  shares        numeric,
  price         numeric,
  amount        numeric not null,       -- always positive; kind says the direction
  note          text,                   -- the manager's reasoning, or the trigger description
  trigger_key   text,                   -- 'missed_gym:2026-08-06' — unique per real-world cause
  created_at    timestamptz not null default now()
);

create unique index if not exists fund_events_trigger_idx
  on fund_events (trigger_key)
  where trigger_key is not null;

create index if not exists fund_events_recent_idx on fund_events (created_at desc);


-- ---------------------------------------------------------------------------
-- 4. The morning dispatch
-- ---------------------------------------------------------------------------
--
-- What the manager has to say today. Stored rather than generated on view so
-- it reads as a running diary — the same page tomorrow shows a new entry under
-- today's, not a regenerated opinion about the same holdings.
create table if not exists fund_dispatches (
  id            uuid primary key default gen_random_uuid(),
  content       text not null,
  headline      text,
  snapshot      jsonb,        -- positions + value at the time, so history stays honest
  created_at    timestamptz not null default now()
);

create index if not exists fund_dispatches_recent_idx on fund_dispatches (created_at desc);
