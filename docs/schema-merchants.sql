-- Merchants and spending categories, as things rather than as strings.
--
-- The graph had one hub. One project held 24 of its 37 edges — 65% — and the
-- next best-connected thing in the entire system had three. That is not a
-- property of the person's life; it is a property of the roster. Edges here are
-- created by matching a name that actually appears in some text against a list
-- of entities that actually exist, and that list held twelve names: nine people,
-- one project, two places. Everything else in the database had nothing to be
-- connected TO.
--
-- 129 transactions carry a merchant string and a category, both already clean
-- enough to use (44 distinct merchant strings, 11 categories). Promoting them
-- to rows does two separate things, and the second is the reason this exists:
--
--   1. Every transaction gains two factual edges. Useful, but it is money
--      linking to money — a Costco node with twenty grocery charges hanging off
--      it is another star, not an insight.
--
--   2. The roster grows from twelve names to roughly fifty. That is the part
--      that matters. Once loadEntities() knows "Costco", a note saying "need to
--      return that thing to Costco" links a NOTE to a MERCHANT to twenty-one
--      CHARGES — and cross-domain reach is the only thing this graph is for.
--
-- Both tables are keyed by the normalised name rather than a uuid, because the
-- name IS the identity here and because tools/islands.js already emits category
-- refs as {type:"category", id:"eating out"}. A uuid key would mean an insight's
-- stored evidence could not be resolved against the graph it came from.
--
-- Safe to run more than once.


-- ── Merchants ────────────────────────────────────────────────────────────
--
-- `id` is the normalised key ("salt and straw"), `name` the spelling a human
-- recognises ("Salt & Straw"). See merchantKey() in lib/links.js — normalisation
-- is a pure deterministic function, not a model call, so this table can always
-- be rebuilt from transactions alone.
--
-- txn_count is denormalised on purpose. It is read on every roster load to
-- decide which merchants are safe to match against free text (see below), and a
-- count(*) per merchant on that path would be one query per name.

create table if not exists merchants (
  id            text primary key,
  name          text not null,

  txn_count     integer not null default 0,
  total_amount  numeric(12,2) not null default 0,

  first_seen_at timestamptz,
  last_seen_at  timestamptz,

  created_at    timestamptz default now()
);

create index if not exists merchants_seen_idx on merchants (last_seen_at desc);

-- The roster query: repeat merchants first. Only merchants seen more than once
-- are matched against prose, because a one-off charge at "Link.com" would put
-- the word "link" into the matcher and every note mentioning a link would gain
-- a false edge to a payment. A wrong edge is worse than a missing one.
create index if not exists merchants_roster_idx on merchants (txn_count desc);


-- ── Spending categories ──────────────────────────────────────────────────
--
-- Eleven values, already assigned on every transaction. A column, not a table —
-- so why an edge as well?
--
-- Same reason tasks.project_id is ALSO written as a `belongs_to` edge: walking
-- one graph is simpler than remembering which relationships live in columns and
-- which live in edges. A category with 43 charges under it is a real hub, and it
-- is the one hub that can meet an intention ("spend less on eating out") coming
-- the other way.

create table if not exists spend_categories (
  id           text primary key,
  name         text not null,

  txn_count    integer not null default 0,
  total_amount numeric(12,2) not null default 0,

  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);
