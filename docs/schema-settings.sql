-- PersonalOS — settings table
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It creates one small table and touches nothing that already exists.
--
-- Why it can't be done from code: Supabase's REST layer can read and write rows
-- but cannot create tables, so every schema change is a manual paste. The same
-- was true of docs/schema-additions.sql.
--
-- What breaks without it: nothing. The settings panel still works — reading
-- voice, speech rate, autoplay and light/dark all live in the browser. The only
-- control that needs this table is the interruption dial, because the nightly
-- cron has to read it while the phone is asleep. Until this runs, that dial
-- shows a note saying so and the app behaves as "digest + urgent".


create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
