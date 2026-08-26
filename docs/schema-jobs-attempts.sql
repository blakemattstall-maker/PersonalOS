-- Almanac — tell a failed description fetch from a successful one
--
-- Run once in the Supabase SQL editor. One column; nothing existing is touched.
--
--
-- WHY
--
-- 151 of 258 "enriched" postings had a completely empty description. The fetch
-- ran against a Workday or Oracle Cloud page that renders its text in
-- JavaScript, got a shell, stored nothing, stamped detail_fetched_at, and was
-- never looked at again — the pending query is `.is("detail_fetched_at", null)`.
--
-- That is not cosmetic. classifyGradFit on an empty string returns "unknown",
-- and the feed deliberately KEEPS unknown, because most postings state nothing
-- and silence must never read as a no. So postings that explicitly exclude a
-- 2029 graduate — "open to Junior-status college students only", "enrolled as a
-- junior undergraduate", "Expected graduation date: Spring 2028" — sat in the
-- feed looking eligible. The filter was correct. It was never shown the words.
--
-- With this column a read that returned nothing usable leaves detail_fetched_at
-- null and is retried, and only stops after three attempts — enough to tell a
-- transient failure from a page that will never yield to a plain fetch.

alter table job_postings add column if not exists detail_attempts integer not null default 0;

create index if not exists job_postings_detail_attempts_idx
  on job_postings (detail_attempts) where detail_fetched_at is null;


-- Give the 151 that were wrongly marked done another chance. Anything with a
-- real description keeps its stamp; only the empty ones are reopened.
update job_postings
   set detail_fetched_at = null,
       detail_attempts = 0
 where detail_fetched_at is not null
   and (description is null or length(trim(description)) < 200);
