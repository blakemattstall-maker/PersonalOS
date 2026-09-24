-- Almanac internship monitoring is paused.
-- Run this once in the Supabase SQL editor to stop both scheduled callers.
-- The job data and scheduler extension remain intact for a future restart.

select cron.unschedule('almanac-poll-jobs')
where exists (select 1 from cron.job where jobname = 'almanac-poll-jobs');

select cron.unschedule('almanac-enrich-jobs')
where exists (select 1 from cron.job where jobname = 'almanac-enrich-jobs');
