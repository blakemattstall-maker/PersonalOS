-- Almanac — the clock half of the trigger engine
--
-- Paste into the Supabase SQL editor, replacing PUT_YOUR_CRON_SECRET_HERE with
-- the CRON_SECRET from the Vercel project. Requires pg_cron and pg_net, which
-- docs/cron-jobs.sql already enabled.
--
--
-- WHY pg_cron AND NOT vercel.json
--
-- Every entry in web/vercel.json is once a day, because that is what the free
-- plan gives, and the premortem records measured drift of thirty to fifty
-- minutes on this account. A reminder that fires thirty minutes before a
-- meeting cannot be scheduled by something that is itself half an hour late.
-- pg_cron runs inside the database and keeps time.
--
-- Every five minutes rather than fifteen. The finest thing already running is
-- the fifteen-minute job poll, and that is fine for a job board — but a lead
-- time is a promise about a moment, and the firing window has to be narrower
-- than the error a person would notice. Five minutes costs one HTTP call that
-- returns "checked 2, fired 0" and nothing else.
--
-- Place-arrival triggers are NOT here. Those fire from the location ingest, at
-- the moment the arrival is detected — waiting up to five minutes to mention
-- that he is standing in the gym would defeat the point.

select cron.schedule(
  'almanac-run-triggers',
  '*/5 * * * *',
  $$
    select net.http_get(
      url := 'https://www.getalmanac.xyz/api/cron/runTriggers',
      headers := '{"Authorization": "Bearer PUT_YOUR_CRON_SECRET_HERE"}'::jsonb,
      timeout_milliseconds := 55000
    );
  $$
);


-- To check it is running:
--   select * from cron.job where jobname = 'almanac-run-triggers';
--   select * from cron.job_run_details order by start_time desc limit 10;
--
-- To stop it:
--   select cron.unschedule('almanac-run-triggers');
