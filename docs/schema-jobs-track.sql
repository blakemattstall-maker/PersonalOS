-- Almanac — internship monitor, third pass: deadlines and follow-ups
--
-- Run once in the Supabase SQL editor. Three nullable columns on
-- job_postings; nothing existing is touched.
--
-- What breaks without it: the Jobs tab keeps working, but nothing warns that
-- an application closes tomorrow and nothing remembers that a submitted
-- application has gone quiet for two weeks.

-- When applications close, when the posting says so. Greenhouse publishes it
-- as a field; everyone else states it in prose or not at all.
alter table job_postings add column if not exists deadline date;

-- When it was marked applied. The status column already records THAT he
-- applied; this records when, which is the only way to notice silence.
alter table job_postings add column if not exists applied_at timestamptz;

-- The last time this posting caused a notification of any kind beyond its
-- first-seen alert. One row, one cooldown — the same shape the nudge engine
-- uses, so a closing deadline cannot buzz every hour.
alter table job_postings add column if not exists last_nudged_at timestamptz;

create index if not exists job_postings_deadline_idx on job_postings (deadline)
  where deadline is not null;
