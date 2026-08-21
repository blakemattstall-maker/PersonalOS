-- Almanac — internship monitor, second pass
--
-- Run this once in the Supabase SQL editor. It only adds nullable columns to
-- job_postings; nothing existing is touched and nothing is dropped.
--
-- What breaks without it: the Jobs tab keeps working exactly as it does today
-- (title-based filtering), but cannot narrow to Summer 2027, cannot rule out
-- postings that require a graduation year Blake does not have, and cannot sort
-- by pay. The code degrades to the old behaviour rather than failing.
--
-- Why these live on the posting rather than being recomputed per request: they
-- come from the job DESCRIPTION, which costs one extra fetch per posting.
-- Storing the verdict makes it a one-time cost per requisition.

-- The description itself, kept so a classifier can be improved and re-run over
-- history without re-fetching 260 pages.
alter table job_postings add column if not exists description text;

-- 'summer_2027' | 'other' | 'unspecified'
-- "other" means the posting NAMED a term and it was not summer 2027 (a Fall
-- 2026 co-op, a Summer 2026 role still listed). "unspecified" means it never
-- said — which is common early in a cycle and must not be treated as a no.
alter table job_postings add column if not exists term text;

-- 'ok' | 'blocked' | 'unknown'
-- Whether the posting's stated graduation-year or class-standing requirement
-- admits the class of 2029. Blocked is only ever set from an explicit
-- requirement, never inferred from silence.
alter table job_postings add column if not exists grad_fit text;

-- Published pay, when a posting states it. Many do not; several states now
-- require it, so this is populated often enough to sort by.
alter table job_postings add column if not exists pay_min numeric;
alter table job_postings add column if not exists pay_max numeric;
alter table job_postings add column if not exists pay_period text;  -- 'hour' | 'year'

-- Coarse discipline: product | marketing | media | business | finance |
-- supply_chain | legal | technical | other. Used to cut whole categories out
-- of the feed rather than fighting them one title at a time.
alter table job_postings add column if not exists field text;

-- When the description was last fetched, so enrichment is resumable and never
-- re-fetches what it already has.
alter table job_postings add column if not exists detail_fetched_at timestamptz;

create index if not exists job_postings_term_idx on job_postings (term, match_score desc);
create index if not exists job_postings_field_idx on job_postings (field);
