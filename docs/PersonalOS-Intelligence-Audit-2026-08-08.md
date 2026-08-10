# PersonalOS — Intelligence Architecture Audit

> **Historical document (Aug 8).** The audit's findings were all fixed and its Phase 0–2 roadmap fully executed; Phase 3 remains open. For current state read `PersonalOS-Current-State-Handoff.md`; for the plan, `PersonalOS-Finish-Plan.md`.

**Date:** 2026-08-08
**Method:** Read the code, then verified every claim against the live Supabase and the live SimpleFIN cache. Nothing here is taken from the handoff docs; where the docs and the code disagree, that is noted.

> ## ✅ Phases 0 and 1 were built on 2026-08-09
>
> Commit `4d237e3`. All three live defects (D1–D3) are fixed, the stale doc (D4) is corrected, and the graph has a read side. `npm test` is at 144.
>
> **One thing the audit did not predict, found while building:** the merchant classifier could return `transfers`, and was doing so for Tagadapay.com — silently removing $188.44 of real purchases from the 90-day spend total, non-reproducibly. Fixed by withholding the two categories that move a total from the model entirely (`MODEL_CATEGORIES`). This belongs with D2 as a fourth instance of the same root cause.
>
> **A fifth defect, in the same family, found by a test written for Phase 1:** PostgREST caps responses at 1000 rows and `.limit()` does not raise it. `visitsInWindow` shipped with it, and `shouldCreatePlace` plus the orphan-adoption pass in `tools/location.js` had it already. See README trap #21.
>
> **Phase 2 shipped the same day** (`ea12fe4`): connection-aware context wired into `buildRichContext`, cross-finding synthesis by shared entity, and insights given a surface and a feedback signal. 161 tests.
>
> Three things Phase 2 turned up that this audit did not anticipate:
> - **Insights had no surface at all**, not merely a weak one. §2.2 G5 called them "terminal" — the truer statement is that at every interruption level below `everything` they were written and then unreachable by any means. Three were sitting undelivered and unseeable.
> - **The connection lookup is genuinely free when it does not apply** (0 ms, zero queries). That property is what makes it safe in every reasoning call, and it was not obvious in advance that it could be had.
> - **A server action that throws takes down the whole page.** There is no `error.js` anywhere in this app, so `resolveInsight` throwing on a bad id would have meant "This page couldn't load" for a button that clears one card. Two failure shapes have to be checked, not one — see README trap #15.
>
> **Still open, deliberately:** Phase 3 (longitudinal — blocked until ~mid-September 2026, when there are 6–8 weeks of correctly-defined `daily_metrics`), wiring `resolveReference()` into the capture path, and giving the graph a surface of its own.
>
> The framework this audit describes is now defined properly in **`PersonalOS-Knowledge-Architecture.md`**, which is the document to read first.

---

## 0. What was actually checked

- Every file in `web/lib/`, `web/tools/`, `web/app/api/`.
- Live migration probe (`lib/schema.js`) against production Supabase.
- Live row counts and column lists for all 26 tables.
- Live `buildSignals()` output.
- Live comparison of the two money summarisers.
- `npm test` — 121 tests, all passing.

Live data volumes (2026-08-08):

| Passive / machine-generated | | Active / user-generated | |
|---|---|---|---|
| location_points | 1,287 | memories | 16 |
| activity_logs | 621 | intentions | 7 |
| transactions | 127 | people | 9 |
| news_items | 29 | notes | 1 |
| daily_metrics | 11 | projects | 1 |
| entity_links | 36 | deep_thoughts | 5 |
| insights | 3 | places (labelled) | 1 of 2 |

`activity_logs` spans 2026-08-03 → 2026-08-08. **The entire behavioural record is five days old**, and 405 of its 621 rows are location pings. Roughly 200 real user actions exist. Every conclusion below is shaped by that fact.

---

## 1. Current intelligence architecture

### 1.1 The four things that are genuinely built

**A. A dispatch layer that works.** `/api/capture` → `lib/router.js` → 23 tools. Native tool-calling, multi-tool per utterance, scoped question extraction per tool, pending-clarification resume, audio transcription in front of the same pipeline. The routing eval exists and runs each phrase 4×. This is solid and is not where the leverage is.

**B. A context assembly layer — `lib/context.js`.** `buildRichContext({ query })` returns five things: retrieved memories, the profile bio, a bodyweight trend, `lib/signals.js`, and `recentInsights()`. Ten call sites use it (brief, observer, nudges, answer, deepThinking, thread ×2, news, gmail ×2, googleDocs). **This is the real spine of the intelligence layer** — more so than the router. Every reasoning call in the system sees exactly what this function decides it sees.

**C. A computed-facts discipline.** The single best architectural decision in the repo: facts are computed in code, the model only phrases them. `lib/signals.js` (six cross-domain signals), `tools/brief.js` (`renderFacts` — hours committed, overlaps, overdue, kinds), `tools/islands.js` (`detectFindings` — four detectors), `lib/eventKind.js` (`analyseDay`). Prompts repeatedly say "already calculated — never re-total these." This is what makes the system explainable and falsifiable, and it should be treated as inviolable.

**D. A graph — `lib/links.js` + `entity_links`.** Polymorphic edges across 11 entity types, upserted on a natural key so re-extraction is free, name-matched with word boundaries, degrading to "no links" when the table is absent. Deliberately refuses to guess.

### 1.2 Where intelligence actually happens today

| Where | What it does | Reads |
|---|---|---|
| `tools/brief.js` | daily brief, 4am write / 6am push | calendar (live), tasks (live), people, intentions, projects, Gmail, `buildRichContext` |
| `tools/observer.js` | once-a-day "is anything worth saying" | `buildRichContext` + `daily_metrics` + its own 14-day memory of what it already said |
| `tools/islands.js` | nightly graph rebuild + 4 detectors | `entity_links`, transactions, people, intentions, projects |
| `tools/nudges.js` | per-intention "is today the moment" | `buildRichContext` + per-intention memory retrieval |
| `tools/memory.js` | pgvector retrieval, verified live (16/16 embedded) | `memories` |
| `lib/dedupe.js` | "I already know that" — normalise → overlap → model | one table at a time |

### 1.3 Data flow, honestly drawn

```
capture ─┬─▶ tool ─▶ Supabase / Google          (immediate)
         └─▶ activity_logs

                    ┌── nightly cron ──┐
Supabase rows ─────▶│ rebuildLinks     │──▶ entity_links ──▶ detectFindings ──▶ insights
                    │ syncTransactions │                          ▲
                    │ rollupDailyMetrics──▶ daily_metrics ────────┼──▶ observer only
                    └──────────────────┘                          │
                                                                  │
buildRichContext ──▶ memories + bio + bodyweight + signals + recentInsights(text)
       │                                    ▲                     │
       └──▶ 10 reasoning tools              └── NOT the graph ─────┘
```

The important shape: **the graph is a write-mostly side-channel.** It is written nightly and read by exactly two detectors (`neighbours()` is called in precisely two places, both inside `detectFindings`). Its output reaches the rest of the system only as five lines of flat prose via `recentInsights()`. No tool, no query, no retrieval path, and no page ever walks it.

---

## 2. Gaps and opportunities

### 2.1 Already adequately solved — do not rebuild

- **Tool routing and dispatch.** Adding a tool is a schema entry plus a router case. Leave it.
- **Deduplication.** `lib/dedupe.js` is well-designed (free path first, model only on shortlist, temperature 0, conservative default). It only covers `memories`/`notes`/`intentions`, which is the right scope.
- **Memory retrieval.** pgvector is live and all 16 memories are embedded. Verified, not assumed.
- **Interruption budget.** `URGENCY_TIERS` + one-digest-a-day + `recentlySaid()` is a correct and well-reasoned design. The observer refusing to claim trends below 14 days of history is right and should not be "fixed".
- **Model tiering.** `lib/models.js` with a contract test. Fine.
- **Graceful degradation + `lib/schema.js`.** The migration probe is the right instinct. See 2.3 for its one hole.

### 2.2 The five genuine gaps, highest leverage first

**G1 — The graph is not a retrieval surface.**
This is the single largest gap. `entity_links` holds real edges and nothing can ask it anything. Concretely, none of these are answerable today:
- "everything connected to this project" (the roadmap already names this)
- "which of the three things involving Priya do you mean" — `tools/pending.js` handles one-shot clarification only; ambiguity across days has no resolver
- "this `relationship_debt` finding and this `project_cost` finding are about the same project" — each detector fires blind to the others
- context assembly by *connection* rather than by *recency + cosine similarity*

The primitives all exist (`neighbours`, `findMentions`, `loadEntities`, `LINKABLE`). What's missing is a traversal function and the two or three consumers that would use it.

**G2 — Location is a disconnected island, and it is the largest dataset.**
1,287 points, 2 places, 1 labelled. `place` is in `LINKABLE` and has **zero edges**. Place linkage today depends on a place's *label text* happening to appear in a memory or a merchant string — and `findMentions` will match on the first word of a multi-word label, so "Temporary internship home" would link anything containing "Temporary". It is simultaneously unable to fire and able to fire wrongly.

Nothing connects a visit to the calendar event, the person, or the transaction that happened during it — which is exactly the join that would make location worth its storage. `minutes_at_gym` in `daily_metrics` is hardcoded `null`.

**G3 — Longitudinal understanding exists as a table with one reader.**
`daily_metrics` is described in its own migration as "the substrate for every 'when X, you also Y' claim". `getRecentMetrics()` is called in exactly one place: the observer. The brief doesn't see it. The detectors don't see it. `buildRichContext` doesn't see it. Nothing computes a delta, a streak, or a change-point — every signal in `lib/signals.js` is a snapshot of *now*, so the system can say "10 tasks past due" but never "that's up from 3 last week."

**Do not fix this by generating trend claims.** There are 11 rows. The correct move is to make the *substrate* correct and connected now, so that when 8 weeks of history exists the analysis is a small addition rather than a new subsystem. The observer's refusal to claim trends stays.

**G4 — The graph is only ever built nightly, from a bounded scan.**
`rebuildLinks()` runs at 06:00 UTC, scans `limit(500)` per table, and awaits each `link()` sequentially. Two consequences:
- A capture made at 9am is invisible to the graph until the next morning — so nothing can react to a connection at the moment it's made, which is precisely when it is most useful.
- The scan is O(rows × entities) sequential HTTP round-trips with a hard 500-row ceiling. Fine at 50 rows; it silently starts dropping the oldest rows well before it starts being slow, and nothing will say so.

**G5 — Insights are terminal.** An insight is written, phrased, pushed once, and thereafter appears as one line of prose in `recentInsights()`. `insights.entities` (the structured facts that produced it) is never read back. `acted_on` is never set by anything. There is no feedback loop — nothing learns that a kind of insight was useful or ignored, so the detectors cannot improve with use.

### 2.3 Live defects found during the audit

These are not roadmap items — they are bugs in the shared substrate, and each one degrades silently, which is the failure mode the pre-mortem names as the killer.

**D1 — `projectSignal` has been dead since it was written.**
`lib/signals.js:211` selects `title` from `projects`. The column is `name`. Verified live:
```
projectSignal query -> ERROR: column projects.title does not exist
```
`if (error || !data ...) return null` swallows it, so the "Projects:" line is silently absent from `buildSignals()` — and therefore from the brief, the observer, every nudge evaluation, deep thinking, `general_question`, news ranking, Gmail drafting and Docs export. The stalled-project accountability story does not exist in production. Live output confirms five lines where there should be six.

**D2 — A third money summariser, disagreeing with the other two by 3×.**
`financeSignal` totals all outflows with no category awareness. The money page (`summarise`) excludes `transfers`. For the same live 30-day window:
```
signals.js style (all outflows):     2156.41
categorised, excluding transfers:     711.48
```
So every reasoning call in the system is currently told "out $2156, biggest: Zelle Transfer To $1385" while the money page says $711. This is README trap #17 (*"sharing an entry point is not sharing the arithmetic — share the function"*) recurring in a third place, and it is in the one summary that rides into everything. `rollupDailyMetrics`'s `spend_total` has the same flaw, so `daily_metrics` is accumulating history against the wrong definition of spend.

**D3 — The migration probe doesn't cover the graph.**
`docs/` holds 10 `.sql` files. `lib/schema.js`'s `MIGRATIONS` covers 8. Missing: **`schema-islands.sql`** (`entity_links`, `transactions`, `insights`) and `schema-nudge-scheduling.sql`. The guard built specifically to prevent silent degradation has its blind spot exactly on the newest and most important layer. Both happen to be applied — that is luck, not verification.

**D4 — Stale architecture doc.** `PersonalOS-Architecture-Source-of-Truth.md` still says the entity graph is "partially emerged, not deliberately built" (S7), that push was declined (S5), that there are four crons (there are ten schedules), that Financial/Relationship/Location Intelligence are "none started" (all three are built), and lists `gpt-4o-mini` as the routing tier. Anyone picking this up cold is being misled by the document that claims to be the source of truth. The handoff doc is current; this one isn't.

---

## 3. Target architecture

Not more tools. The same tools, standing on three things that don't exist yet.

**A resolved present tense.** One function that answers "what is true right now" — the current state of every domain, computed, cached, with each fact carrying its provenance and its age. `lib/signals.js` is the ancestor of this; it is currently a prose blob assembled fresh on every call, with no structure a consumer can index into and no way for a caller to ask for one domain. The target is structured facts that render to prose, not prose.

**A graph that is read as often as it is written.** `entity_links` becomes the substrate for retrieval and disambiguation, not just for detection. Three consumers make it real: context assembly (pull what's *connected* to the subject, not only what's semantically near it), reference resolution ("the thing with Priya"), and a synthesis pass that can see that two findings share an entity. Edges get written at capture time, not only nightly.

**A history that is queried, not just accumulated.** `daily_metrics` gains readers and correct definitions now, and gains *analysis* only when there is enough history to support it. The value of this layer is entirely deferred — which is exactly why the substrate has to be right today, because you cannot retroactively fix eight weeks of wrongly-defined `spend_total`.

The through-line: **observation → interpretation → intervention already exists as a pipeline** (`detectFindings` → phrasing → `pushAllowed`). It is thin at every stage — four detectors, one phrasing call, one tier table — but the shape is correct. Deepen it; do not replace it.

---

## 4. Prioritized roadmap

Four phases. Each is one Claude Code session. Each preserves everything currently working.

---

### Phase 0 — Repair the shared substrate
**Objective:** The facts every reasoning call depends on are correct, and the drift detector covers everything.
**Dependencies:** none.
**Why first:** Phases 1–3 all compound on `buildSignals` and `daily_metrics`. Building on a signal that's 3× wrong and one that's missing means every downstream judgment inherits the error, and `daily_metrics` accumulates bad history the whole time.

- Fix `projectSignal`'s `title` → `name` (D1).
- Make `financeSignal` and `rollupDailyMetrics` use the same categorised totals as the money page — share the function, not the route (D2).
- Add `schema-islands.sql` and `schema-nudge-scheduling.sql` to `lib/schema.js`'s `MIGRATIONS` (D3).
- Add a test that every `docs/schema-*.sql` file has a `MIGRATIONS` entry, so this hole cannot reopen.
- Add a test that every column named in a `lib/signals.js` select exists — or, more cheaply, make each signal log loudly on a *query* error rather than returning `null` indistinguishably from "no data". The distinction between "nothing to say" and "the query is broken" is the whole lesson of S6.
- Refresh `PersonalOS-Architecture-Source-of-Truth.md` (D4).

**Done when:** live `buildSignals()` prints six lines; the money figure in signals matches the money page to the cent; the probe reports on all 10 SQL files; `npm test` covers the two new invariants.

---

### Phase 1 — Make the graph readable
**Objective:** `entity_links` becomes something the system can ask questions of.
**Dependencies:** Phase 0.

- `lib/links.js` gains `walk({ type, id, depth, minConfidence })` — a bounded multi-hop traversal that resolves edges to real rows and returns them ranked by connection strength and recency. Bounded depth (2) and a hard result cap; a graph walk that can fan out is a cost incident.
- `resolve({ text })` — given "the thing with Priya", return candidate entities ranked by connection strength and recency. Reuses `findMentions` + `walk`.
- Fix place linking: link a `location_point`/`place` to the calendar events, transactions and people whose *timestamps overlap the visit*, rather than hoping a label string appears in prose. This is the join that makes 1,287 points worth keeping, and it is arithmetic, not inference. Populate `minutes_at_gym` (or better, generalise it to per-place minutes) from it.
- Write edges at capture time as well as nightly: `link()` after each write in the tools that produce linkable rows. The nightly `rebuildLinks` stays as the healer.
- Raise the `limit(500)` ceiling to a cursor, or at minimum log when a table hits it.

**Done when:** `walk()` returns the full neighbourhood of the one real project in under a second; a location visit produces edges to whatever else happened during it; a capture naming a known person produces its edge within the same request; `entity_links` grows materially past 36.

---

### Phase 2 — Connect the graph to what the system says
**Objective:** Connection-aware context and cross-finding synthesis.
**Dependencies:** Phase 1.

- `buildRichContext({ query, subject })` gains a `connections` field from `walk()`, alongside (not instead of) semantic memory retrieval. Keep it terse — this rides in every reasoning call and the token budget is the reason it's terse today.
- A synthesis pass over `detectFindings()` output: group findings that share an entity before phrasing, so a `relationship_debt` and a `project_cost` about the same project become one sentence. This is the roadmap's "Jarvis personality" item, and the graph is what makes it computable rather than a model's impression.
  - **Design constraint to hold:** grouping findings by a shared entity is arithmetic and is safe. Letting one *finding* be built from another finding's *output* is not — that is where a chain of inferences starts sounding more certain than any link in it. Group, then phrase once. Do not chain.
- Wire `MoneyAsk`/`general_question` answers back through prompts so an in-app conversation is visible to tomorrow's brief (already scoped on the roadmap; trivial once the graph exists to hang it on).
- Set `insights.acted_on` from something real — a dismissal, a resolved nudge, a related capture within N days — so the system has any signal at all about which findings were worth making.

**Done when:** two findings about one project produce one insight; a deep thought about a project sees that project's connected memories, transactions and people; an insight has a non-trivial `acted_on` rate to look at.

---

### Phase 3 — Longitudinal, when there is something to be longitudinal about
**Objective:** The system can say what changed, not only what is.
**Dependencies:** Phase 0 (correct definitions), and ~6–8 weeks of `daily_metrics`. **Do not start before mid-September 2026.**

- Structured deltas in `lib/signals.js`: each signal gains a week-over-week comparison computed in code, with an explicit "insufficient history" state that renders as nothing.
- `daily_metrics` becomes a reader for the brief and the detectors, not just the observer.
- A change-detection detector in `islands.js` — a metric moving beyond its own trailing variance is a *computed* finding, which is the only kind this system is allowed to make.
- The observer's `MIN_DAYS_FOR_TRENDS` gate stays exactly as it is.

**Done when:** the brief can say "up from 3 last week" with the arithmetic done in code; nothing claims a trend the row count doesn't support.

---

### Deliberately not on this list

- **Ambient input (voice / wearable / NFC / camera).** Voice already works via the Shortcut and `/api/capture` accepts audio. More input surfaces multiply the passive:active ratio, which is already 3:1 in favour of passive — and the passive data that exists (1,287 location points) is currently doing nothing. Connect what you have before collecting more.
- **Making the entity graph user-editable.** A second source of truth the extractor has to reconcile with. The roadmap already flags this as needing a decision first; it still does.
- **Multi-tenancy, Plaid migration, two-way calendar sync.** Unchanged from the existing roadmap's reasoning.
- **Correlation claims.** Eleven days of metrics. The observer is right to refuse.

---

## 5. Immediate next phase — what to give Claude Code first

**Phase 0, as one session.** Specifically:

> Fix the shared substrate that every reasoning call in PersonalOS depends on.
>
> 1. `lib/signals.js`'s `projectSignal` selects `projects.title`, which does not exist — the column is `name`. The query errors, the error is swallowed by `if (error || !data) return null`, and the "Projects:" line has never appeared in `buildSignals()` output in production. Fix the column and the `p.title` reference below it.
> 2. `financeSignal` in the same file totals every outflow with no category awareness, so it reports $2,156 for the same 30 days the money page reports $711 — the difference is `transfers`. Make it use the same categorised summary the money page uses (`lib/categorize.js`'s `categorizeTransactions` + `summarise`) rather than its own arithmetic. Do the same for `spend_total` in `tools/metrics.js`'s `rollupDailyMetrics`, and consider whether existing `daily_metrics` rows should be recomputed.
> 3. Each signal in `lib/signals.js` returns `null` on both "query failed" and "nothing to report", which is exactly how #1 stayed invisible. Make a query error log loudly and distinguishably; keep the null return so a broken signal still can't take down a brief.
> 4. `lib/schema.js`'s `MIGRATIONS` list omits `docs/schema-islands.sql` and `docs/schema-nudge-scheduling.sql`, so the probe reports "All migrations applied" without ever checking the graph layer. Add both, and add a test that fails if any `docs/schema-*.sql` file has no `MIGRATIONS` entry.
> 5. Update `docs/PersonalOS-Architecture-Source-of-Truth.md` §3 (S3, S5, S7), §4 and §5 — they describe a system from several days ago.
>
> Verify by running `buildSignals()` against the live database and confirming six lines, and that its money figure matches `/api/finance`'s 30-day view. `npm test` must stay green.

**Why this and not the graph work:** Phase 1 is the more interesting session and the more valuable one, but every part of it feeds `buildRichContext`, and `buildRichContext` currently carries a 3× wrong money figure and a missing projects line into ten reasoning tools. Fixing the substrate is a two-hour job that makes everything built afterwards trustworthy. It is also the cheapest possible proof of the pre-mortem's central thesis — that silent degradation, not failure, is what kills this system: two of these three defects were invisible from the dashboard, invisible in the tests, and invisible in a document that says "All migrations applied and active."
