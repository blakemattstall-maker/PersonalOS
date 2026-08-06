-- PersonalOS — recurring reminders, event colour, and staggered check-ins
--
-- Run this once in the Supabase SQL editor. Safe to re-run.
-- Run docs/schema-practice-split.sql too if you haven't — they're independent.


-- ---------------------------------------------------------------------------
-- 1. Tasks can be a recurring reminder, and can belong to a person
-- ---------------------------------------------------------------------------
--
-- Birthdays and anniversaries were being written as one-off CALENDAR events,
-- which was wrong twice: they cluttered a calendar meant for things that
-- actually occupy time, and they only ever existed for the single next
-- occurrence, so 2028's birthday simply never appeared.
--
-- They're tasks now. The Google Tasks API has NO recurrence field — recurring
-- tasks exist in Google's UI but are not exposed through the v1 API at all —
-- so recurrence is ours to run: a daily job materialises next year's reminder
-- when the date comes back around.
--
-- recurrence_key is what stops that job creating a duplicate every single day
-- once a date is inside the lead window. It looks like
-- "person:<uuid>:birthday:2027", and the unique index is the real guarantee —
-- a check-then-insert would still double up on a retry or a concurrent run.
alter table tasks add column if not exists person_id uuid references people(id);
alter table tasks add column if not exists recurrence_key text;

create unique index if not exists tasks_recurrence_key_idx
  on tasks (recurrence_key)
  where recurrence_key is not null;


-- ---------------------------------------------------------------------------
-- 2. Calendar events record their colour and recurrence
-- ---------------------------------------------------------------------------
--
-- Google is the source of truth for both, but the local row is what the
-- dashboard and every "what's on this week" answer read from, so it has to
-- carry them or the app can't tell a recurring class from a one-off meeting.
--
-- color_id is Google's palette id as text ("11" is Tomato/red, the default for
-- anything PersonalOS creates so it's identifiable at a glance in the app).
-- recurrence stores the RRULE string actually sent.
alter table calendar_events add column if not exists color_id text;
alter table calendar_events add column if not exists recurrence text;


-- ---------------------------------------------------------------------------
-- 3. Check-in staggering needs no schema change
-- ---------------------------------------------------------------------------
--
-- Noted here because its absence is deliberate. Every person's next check-in
-- was computed as simply now + check_in_days, so saving five people in one
-- evening with the same cadence scheduled all five for the same morning —
-- forever, since answering one resets from that day. That pile-up is the exact
-- thing that gets a feature muted.
--
-- The fix is entirely at write time in tools/people.js: the target date is
-- nudged forward until it lands on a day nobody else is due. That needs no
-- stored state, because next_check_in_at across the table IS the state.
