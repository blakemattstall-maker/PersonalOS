# PersonalOS — Knowledge Architecture

**What this document is:** the definition of what PersonalOS knows, how it comes to know it, how the pieces connect, and what it is allowed to conclude. This is the core of the product. Everything else — the tools, the pages, the notifications — is a surface over what is written here.

**Status:** current as of 2026-08-09, verified against the code and the live database rather than against any earlier document. Where a rule below has a file next to it, that file is the enforcement; where a rule has a test next to it, the test is what stops it eroding.

---

## 1. The five kinds of knowledge

PersonalOS does not have "data". It has five distinct kinds of knowledge, and the distinctions are load-bearing — they decide what gets retrieved, what gets nudged about, what gets rewritten and what gets forgotten. Collapsing any two of them breaks something real.

| Kind | Table | It answers | Lifecycle |
|---|---|---|---|
| **Memory** | `memories` | *Who is this person?* | Deduplicated on write, embedded for retrieval, folded into the bio weekly |
| **Note** | `notes` | *What did they write down?* | Deduplicated on write, read back verbatim |
| **Intention** | `intentions` | *What did they say they wanted?* | Judged daily for whether today is the moment; expires |
| **Record** | `tasks`, `calendar_events`, `people`, `projects`, `transactions`, `location_points` | *What is actually true right now?* | Mirrors an external system or accumulates |
| **Derived** | `daily_metrics`, `entity_links`, `insights`, `briefs`, `prompts`, `nudges` | *What follows from the above?* | Recomputed; never the source of truth |

### The distinctions that matter

**Memory vs. note.** A memory changes how the system talks to you; a note is something you will look up later. "I hate being congratulated" is a memory. "The library closes at 10 on Fridays" is a note, *even when the sentence starts with "remember"*. The test in `lib/toolDefinitions.js` is whether the subject of the sentence is the user. Getting this wrong doesn't just misfile a row — memories are embedded and injected into every reasoning call, so a library's opening hours would ride along in the prompt for a question about someone's career.

**Intention vs. task.** A task has a due date and lives in Google. An intention is "I've been meaning to…" — captured on a deliberately wide net, with no commitment attached, and judged later. This is the *capture liberally, judge later* pattern, and it is why `save_intention` fires on a passing remark rather than waiting to be asked.

**Record vs. derived.** Nothing derived is ever a source of truth. `daily_metrics` recomputes a trailing window on every run precisely so a bad row heals itself; `entity_links` is rebuilt nightly from the records; `insights` are re-detected from scratch and deduplicated by fingerprint. If a derived table were ever trusted over the record it came from, a single bad night would become permanent history.

---

## 2. How knowledge enters

Two doors, and the ratio between them is the single most important fact about this system.

### Active capture — the user says something

```
iPhone Shortcut ──audio──▶ /api/capture ──▶ transcribe ──▶ router (LLM picks tools)
                                                              │
                                              ┌───────────────┴───────────────┐
                                         23 tools                     pending clarification
```

The router's only job is choosing tools and extracting arguments. It deliberately carries **no memories and no context** — that was tried, cost tokens on every request, and measured no better. Tools that actually reason pull their own context.

Every capture path passes through two gates before anything is written:

1. **Deduplication** (`lib/dedupe.js`) — normalise, cheap token-overlap prefilter, then a pinned-temperature model call only on a shortlist. Returns `new` / `duplicate` / `update` / `conflict`. An update *says* what changed, because silently overwriting something the user told you is how a system starts holding a different version of their life than they do.
2. **Date resolution** (`lib/resolveDates.js`) — "tomorrow" is pinned to a real date at capture. A stored relative date is read back days later by something with no idea when it was written, and this caused a notification announcing an internship ending "tomorrow" the morning after it ended, in two separate features.

### Passive capture — the world reports

| Source | Arrives via | Volume (2026-08-09) |
|---|---|---|
| Location | Overland → `/api/ingest/location` | 1,287 points |
| Banking | SimpleFIN, 12h cache | 127 transactions |
| Calendar / Tasks | Google, read live | ~40 |
| Email | Gmail, read-only | on demand |
| Canvas | ICS, daily | on demand |
| News | RSS, daily | 29 items |
| The system's own behaviour | `activity_logs` | 621 rows |

**Passive outweighs active roughly 3:1 and the gap widens every day.** This is the thesis the whole architecture rests on: a person will not narrate their life to a text box, but their phone, bank and calendar will. The consequence is a standing design rule — *connect the passive data you already collect before adding another collector.*

---

## 3. How knowledge connects — the graph

Every domain in this system began as an island. `entity_links` is what joins them.

### The shape

One polymorphic edge table. Deliberately not a foreign key per pair: a real FK per relationship means a migration every time two domains learn to see each other, and the whole point is that new connections keep arriving. The trade is that the database cannot enforce that a target exists, so `lib/links.js` owns that, and a dangling edge resolves to nothing rather than to a broken page.

```
from_type / from_id  ──[relation]──▶  to_type / to_id
                       confidence
                       source
                       context
```

### Entity types

Defined once, in `ENTITIES` in `lib/links.js`. Each entry names where the row lives, the column a human would recognise it by, and the column that answers "when". **`LINKABLE` is derived from this registry**, not maintained beside it — it was maintained beside it, and had already drifted: `nudge` edges were being written while `nudge` was absent from the list, so those edges could be stored and never read back.

`memory`, `note`, `intention`, `task`, `event`, `project`, `person`, `place`, `transaction`, `deep_thought`, `news_item`, `nudge`, `merchant`, `category`

**`merchant` and `category` are keyed by their normalised name, not a uuid** (`docs/schema-merchants.sql`). The name *is* the identity, and `tools/islands.js` already emits category refs as `{type:"category", id:"eating out"}` — a uuid key would mean an insight's own stored evidence could not be resolved against the graph it came from.

They exist because the graph's problem was never edge-writing, it was that there was almost nothing to write edges **to**. The roster held twelve names — nine people, one project, two places — so one project ended up holding 65% of every connection in the system while 119 of 129 transactions floated unattached. Promoting merchants takes the roster to roughly fifty, and the payoff is not the charges hanging off a merchant (that is money linking to money) but that a **note** saying "return that thing to Costco" now reaches a merchant which reaches twenty-one charges. Cross-domain reach is the only thing this graph is for.

### Relations

| Relation | Meaning | How it is decided |
|---|---|---|
| `mentions` | this text names that entity | Word-boundary name match |
| `belongs_to` | a foreign key that already existed | Read from the column |
| `spent_on` | this charge names that project or person | Merchant-string match |
| `located_at` | this event and this visit overlapped in time | Interval arithmetic |
| `paid_to` | this charge was at this merchant | Read from the column, normalised |
| `categorised_as` | this charge is in this spending category | Read from the column |

### Confidence and source

| | Meaning |
|---|---|
| `source: explicit` | read from a column; the database already knew |
| `source: extracted` | a name that actually appears in the text |
| `source: inferred` | computed from an overlap, not stated anywhere |
| `confidence: 1.0` | full name matched |
| `confidence: 0.9` | a visit overlapped an event — exact arithmetic, but presence is evidence of attendance, not proof |
| `confidence: 0.8` | first name only |

### The rule that governs all of it

> **An edge is created from a name that actually appears in the text, matched against entities that actually exist — never from a model's impression that two things feel related.**

A wrong edge is worse than a missing one, because everything downstream treats edges as fact. This is why:

- Two-letter names are ignored entirely (the false-positive rate swamps what they find).
- `\b` word boundaries on both sides, so "Sam" never matches inside "Samuel" (`tests/graph.test.js`).
- An unlabelled place can never be mentioned, so it is filtered out of the roster.
- **Only people and projects may be recognised from the first word of their name** (`PARTIAL_NAME_TYPES`). "Sam" standing in for "Sam Smith" is how people write; "Quality" standing in for "Quality Food Centers" attaches a supermarket to any sentence about quality, and the same rule hands "Department of Education" the word *department*. It was already wrong for places — the one real place on file is "Temporary internship home", whose first word is *temporary*.
- **A merchant seen once is a node; a merchant seen twice is a name.** Only merchants with two or more charges enter the text matcher (`MIN_TXNS_FOR_ROSTER`). The real data contains a single charge at "Link.com", and putting the word *link* into the matcher would attach a payment to every note that mentions a link.
- **Every call site goes through `mentionsIn()`.** Four places used to loop over the roster and call `findMentions` themselves, which is exactly how the first-word rule reached merchants: there was no single place that knew a merchant is not a person.
- **Transactions get no `located_at` edge.** SimpleFIN returns a posting *date*, not a time — every stored charge sits at exactly 12:00 UTC. Overlapping that against a visit would look precise and mean nothing, and linking a charge to every place visited that day would be wrong more often than right. If a bank ever supplies real transaction times, `tools/location.js` is where it goes.

### When edges are written

**At capture time**, for the row just written (`linkText()`), so a note naming someone is connected within the same request rather than at 6am tomorrow.

**Nightly**, by `rebuildLinks()` in the `connectIslands` cron, which is the healer: it catches rows written while capture-time linking failed, rows written before a person existed to match against, and any type that does not call it. Because `link()` upserts on the natural key, the two can never conflict — the nightly pass over an already-linked row is a no-op.

### Reading the graph

| Function | Answers |
|---|---|
| `neighbours()` | the raw edges touching one node |
| `walk({ type, id, depth })` | everything connected, resolved to readable rows, ranked by distance → confidence → recency |
| `describeNeighbourhood()` | that neighbourhood as a few dozen tokens, for a prompt |
| `connectionsForText({ text })` | what the graph knows about whatever this text is about — the bridge into `buildRichContext()` |
| `resolveReference({ text })` | "the thing with Priya" → ranked candidates + an honest ambiguity flag |
| `graphAnchors()` | what is worth looking at — nodes with more than one edge, ranked by **distinct neighbours** |
| `pruneDangling()` | edges pointing at rows that no longer exist |

Bounded in three ways, because a graph walk is the easiest place in this codebase to accidentally build something expensive: depth capped at 2, node count capped, and hydration is **one query per type** rather than one per node.

`resolveReference` deliberately returns candidates rather than picking one. An ambiguous reference resolved silently to the wrong thing is exactly the confident wrongness that costs trust permanently — the caller decides whether the leader is clear enough to act on or whether to ask.

**`graphAnchors()` counts distinct neighbours, not edges.** Two things can be joined by more than one relation — a deep thought both `mentions` a project and `belongs_to` it, which is two true edges about one connection — and `walk()` collapses those into a single node because a neighbourhood is a set of things, not a set of edges. Counting edges made the live project advertise 24 connections and then draw 23.

**`pruneDangling()` is the other half of the healer.** The polymorphic design traded referential integrity for the ability to link anything to anything, and the accepted cost is that a deleted row leaves its edges behind. Every reader already tolerates that, but tolerating is not being correct, so `rebuildLinks()` now deletes them — last, after every write, so it cannot delete an edge the same pass is about to recreate. An edge whose *type* is not in `ENTITIES` is left alone deliberately: deleting a type's entire history because it has not been registered yet is far worse than a stale edge, and that is precisely how `nudge` edges behaved once already.

### Seeing the graph — `/graph`

The only screen in the app that shows the knowledge structure directly. Three deliberate choices:

**It draws one neighbourhood, never the whole graph.** The real graph is a star — one project holds most of the edges, a few nodes hold a handful, and everything else is a leaf. Drawn all at once that is a dandelion plus a scatter of orphaned pairs, and strictly *less* legible than the fictional net on `/welcome`. So the page centres on one thing and makes every neighbour a door into its own neighbourhood.

**There is no layout library, and that is not a style preference.** A force simulation solves "thousands of nodes, no natural arrangement". This has at most sixty and a completely natural arrangement: one centre, neighbours grouped by which table they came from. Simulating it would scatter those groups into a lumpy, non-reproducible ring and destroy the one informative thing on screen. It also could not be server-rendered and could not read the CSS variables the design system runs on. `web/app/graph/geometry.js` is pure and deterministic, and it is unit-tested for frame bounds, dot collision, label clipping and group contiguity — a diagram whose only test is "it looked fine at desktop width" is a diagram that collides on a phone.

**Grouping is carried by position, an arc and a count — never colour.** Ember means one thing in this app and a diagram has nothing waiting on anybody; fourteen entity types would need fourteen hues that mean nothing. The governing number is `GAP_RATIO`: the space *between* groups is always twice the space *within* one. A first attempt used a fixed angle, which at 23 nodes made the separator narrower than the thing it separated, and every group boundary was invisible.

**It is not a tab.** The bar already holds six, but the real argument is the one the tab bar itself makes about History and Manage data: they are reached from where you would actually want them. Nobody opens an app wanting *the graph* — they want to know what a project touches, or why the system said something. So it is entered from `ProjectCard`, `PersonCard`, and from `InsightCard`, which walks to the entity refs the detectors fired on. That last one is the point: an insight's evidence was previously write-only, recoverable from the database and reachable from nowhere.

**Reading an edge takes two different sentences.** `web/app/graph/phrasing.js` holds both. The list rows put the neighbour first ("Rewrite the positioning page · belongs to"); the caption puts the root first ("Northline Supply · mentioned by · the note"). Sharing one string shipped a caption claiming the merchant *mentions* the note when it is the note that mentions the merchant — a true edge and a false sentence about it. An unfamiliar relation is rendered as itself rather than given an invented inverse.

---

## 4. How knowledge is retrieved

Four mechanisms, each answering a different question. `lib/context.js`'s `buildRichContext()` assembles them and is read by ten reasoning tools — it is the real spine of the intelligence layer, more so than the router.

**1. Semantic memory** (`tools/memory.js`) — pgvector over `memories`, top-12 by cosine similarity to what the caller is reasoning about, **blended with the top-4 by importance** so a standing fact ("allergic to X") never disappears just because today's question doesn't mention it. Falls back to blanket top-N at every failure point — and that fallback is also *correct*, not merely safe, for the daily observer, which scans everything at once and deliberately passes no query.

**2. Cross-domain signals** (`lib/signals.js`) — seven computed lines: money, follow-through, outstanding, intentions, relationships, projects, presence. A few dozen tokens, not a data dump, because this rides in every reasoning call.

**3. Connections** (`connectionsForText()`) — **the other axis, and the one that was missing.** Semantic retrieval answers *what else is ABOUT this*. The graph answers *what else is CONNECTED to this*, and the two have different answers: a project's twelve open tasks and what it has cost do not resemble a question about the project, so no amount of cosine similarity will ever surface them.

It is free when it doesn't apply, which is what makes it affordable in every reasoning call. The entity roster is cached for a minute and the matching is a regex, so a question naming nobody on file returns `null` in **0 ms without touching the database** — measured, not assumed. When something *is* named the work is bounded by construction: at most two anchors, one hop each, one query per entity type rather than one per node.

**4. Insights** (`tools/islands.js`) — what walking the graph noticed, carried forward as context rather than pushed and forgotten. An insight raised last week is context for a deep thought today.

---

## 5. From observation to intervention

The pipeline that makes this an operating system rather than a chatbot. Each stage has a different rule.

```
        OBSERVE                INTERPRET              INTERVENE
   records + passive  ──▶  detected findings  ──▶  phrased, tiered, delivered
      (arithmetic)          (arithmetic)            (judgment, defaults to silence)
```

### Observation is arithmetic

`detectFindings()` computes four kinds of finding, none of which any single table could answer:

| Finding | The connection it makes |
|---|---|
| `relationship_debt` | mentioned repeatedly in memories/notes, but not contacted — the mentions and the silence live in different tables |
| `contradiction` | spending that contradicts a stated intention — money and intentions had never been able to see each other |
| `project_cost` | what a project actually cost — charges had no owner until they were linked |
| `concentration` | one category swallowing the month |

### Interpretation is arithmetic too

Findings are **detected in code**; the model is only ever asked to phrase them, with the exact figures given and an instruction never to invent, round or recompute one. An insight is a claim about someone's life — *"you keep spending on X while saying you want Y"* — and a model inventing those produces confident, specific, unfalsifiable nonsense. A detected finding can be wrong, but it can be checked.

This is the most important rule in the codebase and it appears everywhere: **never let a model do arithmetic and then narrate it.** Compute in code, hand the model the figure as fact.

**Grouping is part of the arithmetic.** Each detector fires blind to the others, so a `relationship_debt` and a `project_cost` about the same project used to arrive as two notifications about one situation — out of a budget of one message a day. Every finding now carries typed entity `refs`, and union-find groups them by shared entity before anything is phrased. It handles the transitive case: A shares a project with B, B shares a spending category with C, so all three are one story.

**And here is the line that must not be crossed.**

> Grouping findings that share an entity is **arithmetic** — two findings either name the same project or they do not, and the graph already says which. Deriving one finding **from another finding's output** is not, and is forbidden.

A chain of inferences starts sounding more certain than any link in it, and the compute-in-code discipline is the first thing to break. So: group, then phrase **once**, from the raw detected facts of every member. A phrased insight is never fed back in as evidence for detecting a new one. `tests/synthesis.test.js` asserts the model's input contains facts and no `body`.

Grouping runs **before** the already-said check, and both the composite fingerprint and each member's own are checked. Otherwise a group's second member survives on its own the night after the group was raised, and arrives as a separate notification about a situation already described.

### Intervention is judgment, and defaults to silence

| Kind | Lowest dial setting that pushes |
|---|---|
| `capture_confirmation` | `digest` — the app answering, not interrupting |
| `digest` | `digest` |
| `urgent` | `digest_plus_urgent` (the agreed default) |
| `nudge`, `relationship_checkin`, `insight` | `everything` |

Every push must be classified in `URGENCY_TIERS` or it is undeliverable — deliberately, so an unclassified interruption fails at review time rather than quietly on someone's phone. This table exists because "nudge" and "relationship_checkin" were once passed to a function that only compared against "digest" and "urgent", which silently meant *never push*, for a week.

Four further constraints, all product decisions rather than tuning knobs:

- **One digest a day at most, and most days none.** Twenty notifications a week "takes the magic out of it"; a muted app kills every other feature.
- **The observer remembers what it already said** for 14 days and will stay silent rather than repeat itself.
- **No trend claims below 14 days of history.** With 11 days of `daily_metrics` on file, the observer is *told* how many days exist and instructed not to say "you always" or "whenever you". This refusal is correct and is not a bug to be fixed.
- **The row is written even when the push is suppressed.** Muting means "stop buzzing me", not "stop thinking" — the observation still appears on the dashboard.

---

## 6. The rules that keep it honest

Every one of these was written after something broke. They are listed here because the knowledge architecture *is* these rules — without them it is a pile of tables.

1. **Compute in code, phrase with the model.** Never the reverse.
2. **One definition per figure, shared as a function.** Sharing a route is not sharing the arithmetic — three summarisers once disagreed by 3× while served by the same endpoint. `lib/money.js` is now the only place a money figure comes from.
3. **A determination that changes a total is never a model's to make.** `transfers` and `income` are decided by rule, so a classifier's answer can shift a merchant between categories but can never move `spent`. (`MODEL_CATEGORIES`.)
4. **Never guess an edge.**
5. **Never store a relative date.**
6. **A failed query must not look like a quiet week.** Every signal distinguishes the two and logs loudly — a signal that returned `null` for both was dead for its entire life without a single error.
7. **Graceful degradation needs a health signal, or it is indistinguishable from working.** `lib/schema.js` probes the database directly rather than trusting a document, and reports *applied but inert* as its own state, because that is the state that looks healthiest and isn't.
8. **A guard must cover the thing it was written to protect.** The migration probe covered 8 of 10 files and truthfully reported full health; a test now fails if any migration file has no entry.
9. **PostgREST caps a response at 1000 rows and `.limit()` does not raise it.** Use `selectAll()`. A scan that silently stops seeing the oldest half of a table reports success the whole time.
10. **Capture liberally, judge later.** The wide net is the feature; the judgment happens at read time, per item, fresh each time.

---

## 7. What PersonalOS deliberately does not know

Stating the boundaries is part of defining the framework.

- **It does not know why.** No causal claims, no correlations, until there is history to support them.
- **It does not know where a charge happened.** See §3 — the data does not support it.
- **It does not know what a place is until told.** There is no way to tell a gym from a coordinate; `minutes_at_gym` fills only from a place the user labelled as one, and reports null rather than guessing.
- **It does not know anything about a second user.** The service key bypasses RLS, which is correct for one server-only user and is the seam where per-user scoping goes if that ever changes.
- **It does not know its own running cost.** Deliberately declined; watched on the provider's dashboard instead.
- **It does not act on money.** Read-only banking by construction, and no trade or transfer is executable from here. This is a hard line, not a UX preference.

---

## 8. Where the framework is thin

Honest gaps, so nobody has to rediscover them.

- **Longitudinal understanding is a substrate with almost no readers.** `daily_metrics` is read by the observer and nothing else. Correct definitions now exist and history is accumulating; the analysis is deliberately deferred until there are 6–8 weeks of it. **Do not ship trend claims before then** — revisit mid-September 2026.
- **The feedback loop is one tap wide.** `acted_on` is now written, but only from an explicit button. Nothing infers that a finding mattered from what the user subsequently did, and with a handful of insights on file there is not yet enough signal to rank the detectors by. It is a loop that exists rather than a loop that works.
- **Only memories are embedded.** Notes, intentions and deep thoughts are retrieved by recency, not relevance. The graph partly compensates — a note naming a project is now reachable through that project — but a note that is *about* something without naming it is still invisible to retrieval.
- **`resolveReference()` is not wired to capture.** It resolves "the thing with Priya" and reports honestly whether the answer is ambiguous; nothing calls it from the capture path yet, so `tools/pending.js` still only handles the one-shot case where the router asks and the next utterance answers.
- **The graph has a surface now, but no tool.** `/graph` exists (§3), so connections are visible and walkable. There is still no `query_connections` tool, so nothing can be *asked* about connections from the Shortcut or in conversation — only `connectionsForText()` riding along inside other reasoning calls.
- **Memories are still not in the graph, and cannot be by name-matching.** All 21 of them are statements *about the user* — "prefers walking over running", "does best work late at night" — naming no person, project or place. The only route in is embedding similarity, which is a guess, and the graph's governing rule forbids it. Decided deliberately, August 2026: memories stay out; they keep reaching reasoning through pgvector retrieval, where a probabilistic match is honestly labelled as one.
- **Place linking is thin.** A visit joins a calendar *event*, and nothing else. Transactions cannot join at all (see §3), and Supabase's `calendar_events` is a partial mirror since the query tools read Google live — so the join reaches less than it looks like it should.

---

## 9. Map of the files

| File | Owns |
|---|---|
| `lib/links.js` | the graph: entity registry, edge writing (single + batch), traversal, anchors, pruning, reference resolution |
| `app/graph/geometry.js` | where the dots go — pure, deterministic, unit-tested |
| `app/graph/phrasing.js` | turning an edge into a sentence, in both directions |
| `lib/context.js` | what every reasoning call sees |
| `lib/signals.js` | the seven computed cross-domain lines |
| `lib/money.js` | the only source of a money figure |
| `lib/categorize.js` | rules-then-model classification; what a model may not decide |
| `lib/dedupe.js` | "I already know that" |
| `lib/schema.js` | which migrations are live, and whether they are doing anything |
| `lib/settings.js` | the interruption budget and urgency tiers |
| `lib/supabase.js` | the client, and `selectAll()` for anything that scans |
| `tools/islands.js` | nightly graph rebuild, the four detectors, insight phrasing |
| `tools/memory.js` | semantic retrieval |
| `tools/location.js` | points → places → visits → edges |
| `tools/metrics.js` | the daily longitudinal row |
| `tools/observer.js` | the once-a-day decision to speak or stay silent |
| `tools/brief.js` | the morning brief, composed from computed facts |
| `tests/graph.test.js` | the graph's invariants |
| `tests/substrate.test.js` | one definition per figure; full migration coverage |
