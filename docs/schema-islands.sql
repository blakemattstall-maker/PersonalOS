-- Connecting the islands.
--
-- Every domain in this system is a separate table that barely references any
-- other. Tasks know their project, and that is nearly the whole graph. Money is
-- not stored at all, memories know nobody, places belong to no one, and nothing
-- records that a charge, a person, a project and a place were the same event.
--
-- Two tables. One holds edges between anything and anything; the other holds
-- what was noticed by walking them.
--
-- Safe to run more than once.


-- ── Edges ────────────────────────────────────────────────────────────────
--
-- Deliberately polymorphic rather than a column per relationship. A real
-- foreign key per pair would mean a migration every time two domains learn to
-- see each other, and the entire point here is that new connections keep
-- arriving. The trade is that the database cannot enforce the target exists;
-- lib/links.js owns that, and a dangling edge degrades to a link that resolves
-- to nothing rather than to a broken page.

create table if not exists entity_links (
  id           uuid primary key default gen_random_uuid(),

  from_type    text not null,
  from_id      text not null,
  to_type      text not null,
  to_id        text not null,

  -- mentions | spent_on | attended_by | located_at | about | blocks | funds
  relation     text not null default 'mentions',

  -- 1.0 for something stated outright, lower for an inferred connection, so a
  -- guess can be told from a fact later.
  confidence   real not null default 1.0,

  -- extracted | explicit | inferred
  source       text not null default 'extracted',

  context      text,

  created_at   timestamptz default now()
);

-- The uniqueness that makes re-running extraction free rather than duplicative.
create unique index if not exists entity_links_unique_idx
  on entity_links (from_type, from_id, to_type, to_id, relation);

-- Both directions get walked, so both directions get an index.
create index if not exists entity_links_from_idx on entity_links (from_type, from_id);
create index if not exists entity_links_to_idx   on entity_links (to_type, to_id);
create index if not exists entity_links_type_idx on entity_links (to_type, relation);


-- ── Transactions ─────────────────────────────────────────────────────────
--
-- Money has only ever existed as a cached blob from the bank, which means no
-- charge can be attached to a person, a project or a place, and nothing can ask
-- what something actually cost. These rows are the anchor those edges need.
-- external_id is the bank's own id, so re-syncing updates rather than doubles.

create table if not exists transactions (
  id            uuid primary key default gen_random_uuid(),
  external_id   text unique,
  account       text,
  posted_at     timestamptz not null,
  amount        numeric(12,2) not null,
  merchant      text,
  description   text,
  category      text,
  created_at    timestamptz default now()
);

create index if not exists transactions_posted_idx   on transactions (posted_at desc);
create index if not exists transactions_merchant_idx on transactions (merchant);


-- ── Insights ─────────────────────────────────────────────────────────────
--
-- What walking the graph noticed. Separate from nudges because a nudge is about
-- something he said he intended; an insight is something nobody said and the
-- connection revealed. Kept as rows rather than pushed-and-forgotten so they
-- can feed back into briefs, deep thoughts and projects.
--
-- fingerprint is what stops the same observation being raised every night: the
-- shape of the finding, not its wording.

create table if not exists insights (
  id           uuid primary key default gen_random_uuid(),
  fingerprint  text unique not null,
  kind         text not null,
  title        text,
  body         text not null,
  entities     jsonb default '[]'::jsonb,
  strength     real default 0.5,
  status       text not null default 'new',
  deliver_at   timestamptz,
  pushed_at    timestamptz,
  acted_on     boolean default false,
  created_at   timestamptz default now()
);

create index if not exists insights_status_idx   on insights (status, created_at desc);
create index if not exists insights_delivery_idx on insights (deliver_at) where pushed_at is null;
