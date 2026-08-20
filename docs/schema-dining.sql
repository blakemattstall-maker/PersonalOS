-- PersonalOS — dining hall menus
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It creates two tables and touches nothing that already exists.
--
-- Why it can't be done from code: same as every schema file here — Supabase's
-- REST layer can read and write rows but cannot create tables.
--
-- What breaks without it: the /food page and the nightly dining sync. Both
-- degrade politely — the page says the tables are missing, the sync logs the
-- same and does nothing — but no menu data can exist until this runs.
--
-- Shape: dining_menus is one row per (station, date, meal) with the items as
-- jsonb; dining_recipes is a nutrition-label cache keyed by (name | serving),
-- because a recipe's label is identical every day it appears. Splitting them
-- is what lets the sync fetch each label once ever instead of once per day —
-- the difference between a sync that fits Vercel's 60s window and one that
-- re-downloads a thousand labels a night.


create table if not exists dining_menus (
  id          bigint generated always as identity primary key,
  station     text not null,
  station_oid integer not null,
  date        date not null,
  meal        text not null,
  menu_oid    bigint not null,
  -- [{ name, serving, course, traits, recipe }] — recipe is the
  -- dining_recipes key carrying the nutrition label.
  items       jsonb not null default '[]'::jsonb,
  fetched_at  timestamptz not null default now(),
  unique (station_oid, date, meal)
);

create index if not exists dining_menus_date_idx on dining_menus (date);


create table if not exists dining_recipes (
  key         text primary key,
  name        text not null,
  serving     text,
  -- { calories, fat_g, fat_dv, …, protein_g, protein_dv, vitamin_a_dv, … } —
  -- nulls where the school's label says NA.
  nutrition   jsonb not null default '{}'::jsonb,
  ingredients text,
  -- The label's "Contains:" line. Diet tags (Vegan, Halal) are traits on the
  -- menu item, not allergens, and deliberately don't live here.
  allergens   text[] not null default '{}',
  detail_oid  bigint,
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
