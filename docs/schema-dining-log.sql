-- PersonalOS — meal tracking and meal plans
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query). It creates one table and adds two nullable columns to
-- daily_metrics; nothing existing is touched otherwise.
--
-- What breaks without it: meal planning and calorie tracking — the Plan tab
-- on /food, the Track buttons, and the plan_meals / log_meal capture tools.
-- The menu itself (docs/schema-dining.sql) keeps working without this.
--
-- Shape: one row per logged entry. A planned meal is a row with
-- status='planned' carrying the picked items and the calendar event it
-- created; something actually eaten is status='eaten'. Totals are
-- denormalised onto the row so the daily rollup is a sum, not a join.

create table if not exists dining_log (
  id         bigint generated always as identity primary key,
  date       date not null,
  meal       text not null,             -- Breakfast / Lunch / Dinner / Snack
  status     text not null default 'eaten',  -- 'planned' | 'eaten'
  station    text,
  -- [{ name, serving, quantity, station, calories, protein_g, carbs_g, fat_g }]
  -- An item that couldn't be matched to the menu keeps its name with null
  -- macros — an honest "logged, nutrition unknown" rather than a guess.
  items      jsonb not null default '[]'::jsonb,
  calories   numeric,
  protein_g  numeric,
  carbs_g    numeric,
  fat_g      numeric,
  source     text,                      -- 'capture' | 'app' | 'planner'
  event_id   text,                      -- Google Calendar event id, planner rows only
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists dining_log_date_idx on dining_log (date);


-- The longitudinal record learns nutrition. Null stays meaningful: null means
-- "nothing tracked that day", never zero — same rule as every other column
-- in daily_metrics.
alter table daily_metrics add column if not exists calories_eaten numeric;
alter table daily_metrics add column if not exists protein_eaten numeric;
