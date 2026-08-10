-- Waitlist signups from the public /welcome page.
--
-- Almanac isn't open to the public, so instead of a real sign-up the tour
-- collects emails here. Written by an UNAUTHENTICATED caller (a stranger on the
-- welcome page) through /api/waitlist, which rate-limits and validates before
-- it ever reaches this table. Emails only — nothing else about the person.
--
-- Paste this into the Supabase SQL editor. Until it exists, the form degrades
-- gracefully (a friendly "try again"), and lib/schema.js reports it pending.

create table if not exists waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,   -- unique so a double-submit is a no-op, not a duplicate row
  source     text,                   -- where the signup came from ("welcome")
  created_at timestamptz not null default now()
);
