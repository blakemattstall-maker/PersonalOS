-- Almanac — a work log: what you did, in order, kept whole
--
-- Run once in the Supabase SQL editor. One table; nothing existing is touched.
--
--
-- WHY NOT MEMORIES
--
-- The first shift at a new job was captured correctly. "On his first day at
-- Redbird Creative, he edited volleyball GIFs for two players, exported about
-- 15 GIFs with custom overlays and adjustment layers" was written to `memories`
-- at 21:25:46. Two minutes later the question "what have I done for Redbird
-- Creative so far?" was answered "I don't have any recorded work or
-- accomplishments for Redbird Creative yet."
--
-- The immediate cause was routing — the question went to a tool that reads the
-- projects table and cannot see memories. But the deeper problem is that
-- memories are the wrong SHAPE for this, and would have failed later even with
-- perfect routing:
--
--   · Retrieval is semantic top-N by similarity and importance. Asked in
--     December for everything done across a semester, forty shift logs return
--     the eight that score highest. A work log has to be COMPLETE, not relevant.
--   · There is no order. "What did I do first, and how did that change" is not
--     answerable from a bag of facts.
--   · Deduplication merges near-identical entries. Two similar shifts are two
--     shifts, not one fact stated twice — and the whole point of logging every
--     one is that the boring repetitions are the evidence of volume.
--   · The staleness sweep exists to retire claims the present contradicts. A
--     dated record of what happened is not a claim about the present and must
--     never be retired.
--
-- So: append-only, ordered, never deduplicated, never swept, and read WHOLE.

create table if not exists work_log (

  id          bigint generated always as identity primary key,

  -- Free text, matched loosely on read: "Redbird Creative", "Redbird
  -- Athletics" and "redbird" all have to find each other, because he will not
  -- say the same name twice.
  org         text not null,

  -- Optional link to a project row, when one exists. Nullable on purpose —
  -- a log entry must never be lost because no project was set up first.
  project_id  uuid,

  -- What he actually said, kept verbatim. Not summarised, not rewritten: the
  -- detail IS the value, and a model that compresses it is deleting the thing
  -- being stored.
  content     text not null,

  -- Figures pulled out of the text IN CODE — "15 GIFs" becomes {"gifs": 15} by
  -- regex — so a total across a semester is arithmetic over real integers
  -- rather than a model being asked to remember what it read.
  metrics     jsonb,

  -- When the work happened, which is not always when it was said.
  occurred_at timestamptz not null default now(),

  created_at  timestamptz not null default now()

);

create index if not exists work_log_org_idx on work_log (lower(org), occurred_at desc);
create index if not exists work_log_project_idx on work_log (project_id, occurred_at desc);

alter table work_log enable row level security;
