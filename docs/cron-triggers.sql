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
-- Every fifteen minutes. The trigger engine uses a twenty-minute firing window
-- plus a unique fire key, so this cadence cannot miss a reminder or send it
-- twice. It cuts idle Vercel invocations from 288 to 96 per day.
--
-- Place-arrival triggers are retired with location tracking. This clock only
-- handles calendar and time-of-day reminders.

select cron.schedule(
  'almanac-run-triggers',
  '*/15 * * * *',
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
