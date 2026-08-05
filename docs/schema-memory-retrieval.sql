-- PersonalOS — retrieval-based memory (S6)
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Adds one column, one index and one function. Nothing existing is touched.
--
-- Why this matters: today every reasoning call (threads, deep thinking,
-- nudges, general questions) pulls a blanket top-N memories by importance and
-- sends all of it, every time, regardless of relevance to that specific call.
-- That's fine at 7 memories. It stops being fine at 200 — every prompt keeps
-- growing, most of what's in it is irrelevant to the actual question, and cost
-- scales with total memory count instead of with what's actually useful. This
-- migration lets the app fetch only the memories relevant to what's being
-- asked right now, via semantic similarity, so context size stays bounded as
-- the memory count grows instead of growing with it.
--
-- The application code already degrades gracefully if this hasn't been run —
-- it falls back to the old blanket-top-N behaviour. Nothing breaks either way;
-- running this just turns retrieval on.


create extension if not exists vector;

alter table memories add column if not exists embedding vector(1536);

-- ivfflat needs data to partition well; with a handful of rows this behaves
-- close to a brute-force scan, which is fine — it gets more useful as the
-- corpus grows, exactly when it starts to matter.
create index if not exists memories_embedding_idx
  on memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);


-- PostgREST can't express a vector similarity ORDER BY through the normal
-- REST interface, so this is called via supabase-js's .rpc().
create or replace function match_memories(query_embedding vector(1536), match_count int)
returns table (
  id uuid,
  type text,
  content text,
  importance int,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    id, type, content, importance, created_at,
    1 - (embedding <=> query_embedding) as similarity
  from memories
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
