-- PersonalOS — relationship management
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Blake's framing, not a resurrection of anything half-built: a people table
-- other features reference — calendar events for someone, periodic check-in
-- nudges keyed to a relationship — not a standalone feature with its own
-- silo. Matches the existing pattern (S7 in the architecture doc): a direct
-- person_id FK on calendar_events, not a generic entity_links table, because
-- the actual need so far is one person per event, not many-to-many.


create table if not exists people (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  relationship          text,    -- free text: "coworker", "college friend", "aunt" — not an enum
  notes                 text,    -- how they met, what they do, anything worth remembering
  email                 text,
  phone                 text,

  -- One important recurring date per person for v1 (birthday, anniversary —
  -- whatever it's labelled). month/day only; year is irrelevant for a
  -- birthday and this avoids a second date-vs-recurring-date table for a
  -- first version. Revisit only if someone genuinely needs a second one.
  important_date_month  integer,
  important_date_day    integer,
  important_date_label  text,

  check_in_days         integer,       -- null = no periodic check-in wanted
  last_contacted_at     timestamptz,
  next_check_in_at      timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists people_next_checkin_idx on people (next_check_in_at);


-- Nullable, ON DELETE SET NULL: removing a person should never take an
-- existing calendar event with it — the event just loses the link.
alter table calendar_events add column if not exists person_id uuid references people(id) on delete set null;
