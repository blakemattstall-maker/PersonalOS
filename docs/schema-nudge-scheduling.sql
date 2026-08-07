-- Nudge scheduling: deliver through the day, not all at once.
--
-- Nudges were generated and pushed in the same breath, from one daily cron, so
-- everything the app had to say arrived in a single clump in the morning. These
-- two columns let generation and delivery come apart: a nudge is written the
-- moment it is decided, and reaches the phone at the hour it is actually
-- actionable.
--
-- Both are nullable and nothing requires them. Until this runs, createNudge
-- falls back to the un-scheduled insert and pushes immediately — the previous
-- behaviour — so the app does not break while this is unapplied.
--
-- Safe to run more than once.

alter table nudges add column if not exists deliver_at timestamptz;
alter table nudges add column if not exists pushed_at  timestamptz;

-- The delivery pass asks one question repeatedly: what is due and unsent?
create index if not exists nudges_delivery_idx
  on nudges (deliver_at)
  where pushed_at is null;

-- Anything already sent under the old immediate-push behaviour must not be
-- re-delivered the first time the new pass runs.
update nudges set pushed_at = created_at where pushed_at is null;
