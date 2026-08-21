-- Almanac — a scheduler for the internship poller that actually keeps time
--
-- WHY THIS EXISTS
--
-- The poller's clock was a GitHub Actions `schedule` trigger every 15 minutes.
-- It was registered, active, and correct — and in over an hour it fired zero
-- times, while a manual run of the same workflow succeeded immediately.
-- That is GitHub's documented behaviour rather than a bug: scheduled events on
-- free runners are best-effort, deprioritised under load, delayed by up to an
-- hour, and sometimes skipped. Acceptable for a nightly job. Useless for the
-- one feature whose entire value is applying the day a posting appears.
--
-- Supabase runs pg_cron, which is a real scheduler inside the database this
-- project already has: no new vendor, no new account, no monthly cost, and it
-- keeps time properly.
--
-- Running BOTH is deliberate and safe. The poller is idempotent — postings are
-- keyed on (source_id, external_id) and a notification is claimed with
-- notified_at before it is sent — so two schedulers firing at once cost one
-- redundant HTTP request and can never double-notify.
--
--
-- HOW TO RUN THIS
--
-- 1. Supabase Dashboard -> Database -> Extensions. Enable `pg_cron` and
--    `pg_net` if they are not already on (search each by name, toggle on).
--
-- 2. Replace PUT_YOUR_CRON_SECRET_HERE below with the value of CRON_SECRET
--    from the Vercel project — the same value the GitHub secret holds.
--
-- 3. Run this whole file in the SQL editor.
--
-- To check it later:   select * from cron.job;
-- To see what it did:  select * from cron.job_run_details order by start_time desc limit 20;
-- To stop it:          select cron.unschedule('almanac-poll-jobs');


create extension if not exists pg_cron;
create extension if not exists pg_net;


-- Idempotent: unscheduling first means re-running this file updates the job
-- rather than failing on a duplicate name.
select cron.unschedule('almanac-poll-jobs')
where exists (select 1 from cron.job where jobname = 'almanac-poll-jobs');

select cron.unschedule('almanac-enrich-jobs')
where exists (select 1 from cron.job where jobname = 'almanac-enrich-jobs');


-- Every 15 minutes: check all 110 boards for postings that were not there
-- last time, and push anything that matches.
select cron.schedule(
  'almanac-poll-jobs',
  '*/15 * * * *',
  $$
    select net.http_get(
      url := 'https://www.getalmanac.xyz/api/cron/checkJobs',
      headers := '{"Authorization": "Bearer PUT_YOUR_CRON_SECRET_HERE"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);


-- Hourly: read the descriptions of anything new, which is what decides term,
-- graduation-year eligibility and pay. Separate from the poll because it is
-- the slow half (one fetch per requisition) and must never delay an alert.
select cron.schedule(
  'almanac-enrich-jobs',
  '7 * * * *',
  $$
    select net.http_get(
      url := 'https://www.getalmanac.xyz/api/cron/enrichJobs',
      headers := '{"Authorization": "Bearer PUT_YOUR_CRON_SECRET_HERE"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
