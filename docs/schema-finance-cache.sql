-- PersonalOS — SimpleFIN response cache
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- WHY THIS EXISTS
--
-- getFinancialData() was called live, straight to SimpleFIN, on every single
-- invocation — and it isn't just the explicit "how am I doing financially"
-- query. It also backs financeSignal() in lib/signals.js, which rides inside
-- buildRichContext(), which nearly every reasoning call in the system pulls
-- in: a general question, a deep-thinking turn, the daily observer, ranking
-- the news feed. Every one of those was a live bank API call the user never
-- asked for, on top of real latency added to the response.
--
-- One row, upserted every 12 hours. A wide window (100 days) is stored
-- regardless of what any single caller asked for, so a 7-day query and a
-- 90-day query both slice the same cached data instead of needing separate
-- cache entries or separate live pulls.
create table if not exists finance_cache (
  id           uuid primary key default gen_random_uuid(),
  payload      jsonb not null,       -- { accounts: [...] }, transactions' dates as ISO strings
  warnings     jsonb not null default '[]'::jsonb,
  fetched_at   timestamptz not null default now()
);

-- Enforced as a single row rather than trusted by convention — a second row
-- would mean two callers racing to decide which is "the" cache.
create unique index if not exists finance_cache_singleton
  on finance_cache ((true));
