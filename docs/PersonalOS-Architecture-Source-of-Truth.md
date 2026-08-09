# PersonalOS — Architecture & Design Source of Truth

**Version:** 2.1
**Date:** August 9, 2026 (§1, §3, §4 and §5 corrected against the live code — see the correction notice below)
**Purpose:** The reference document for *why* PersonalOS is built the way it is, what each feature actually requires, and what order things get built in. Read `PersonalOS-Current-State-Handoff.md` first for the practical "what's true right now," then this doc for the reasoning behind it.

> **For what the system actually knows and how the pieces connect, read `PersonalOS-Knowledge-Architecture.md`.** That document is the definition of the product's core; this one is the reasoning behind how it got built.

---

## ⚠️ Correction notice — August 9, 2026

An audit (`PersonalOS-Intelligence-Audit-2026-08-08.md`) checked this document against the code and found **five claims below that had gone stale**, in a document titled "source of truth". They are corrected in place, but they are listed together here because the pattern matters more than any one of them: this file describes intent, drifts silently as the code moves, and is believed because of its name.

| §  | Said | Actually |
|---|---|---|
| S3 | "Four daily crons" | Ten schedules in `web/vercel.json` |
| S5 | "True push notifications explicitly declined" | Web Push is built and live (VAPID, `lib/push.js`, service worker) |
| S7 | "Entity graph partially emerged, not deliberately built… revisit the generic link-table idea only if…" | Built deliberately, as `entity_links`, with a full read side |
| §4 | "Financial Intelligence, Relationship Management, Location Intelligence — none started" | All three built |
| §5 | `gpt-4o-mini` named as the routing tier | The registry in `lib/models.js` is the only authority; a contract test enforces it |

**Rule going forward:** anything in this document that names a number, a model or a file is a claim that can rot. Prefer pointing at the code that owns it. The two places that cannot rot — because they ask the live system — are `lib/schema.js` (which migrations are applied *and doing something*) and `tests/` (what is still true).

---

## 0. How to use this document

Same as v1.1: the roadmap lists **what**, this document covers **what has to exist first** and **why decisions were made this way**. Most of the original "three missing capabilities" thesis played out as predicted — building the spine (S1–S4 especially) unlocked most of the rest at once.

---

## 1. Honest state of the system today

This section replaces v1.1 entirely — nearly everything in it is now built.

| Capability | Status |
|---|---|
| Reading data back out of Supabase | ✅ Done. Query tools per domain (`query_schedule`, `query_tasks`, `query_notes`, `query_projects`), all callable, all bounded, all synthesizing rather than dumping raw rows. |
| Updating or deleting anything | ✅ Done, further than originally scoped. `updateTaskDueDate`/`updateEventTimes` (first update-capable Google functions, built for the cascade-reschedule feature), `deleteGoogleTask`/`deleteGoogleEvent`/`deleteProject` (full project teardown, real Google + Supabase). Memories/notes/intentions deletable via the `/data` page. |
| Reading from Google (calendar/tasks state) | ✅ Done — live reads, not cached Supabase copies. |
| Running without a user prompt | ✅ Done. Three daily Vercel Cron jobs. |
| Failure logging | ✅ Done since Phase A. |
| Multiple tools in one utterance | ✅ Done (Phase F — native OpenAI tool calling replaced the inline-JSON-schema-as-prompt-text approach entirely). |
| Writing to `goals`/`projects` | ✅ Partially. `projects` is populated by the interactive-threads "build a plan" flow. `goals` is still empty in practice — `buildPlan()` doesn't create goal rows yet, only project rows. `projects.goal_id` exists as a column but has **no real FK constraint** (discovered the hard way — don't trust an embedded Supabase select through it). |
| An actual output surface | ✅ Done — the web dashboard, not just Shortcuts text. |
| Proactive nudges | ✅ Done, but deliberately not via true push (see S5 below) — dashboard-based, surfaced next time the user opens it. |

---

## 2. The three modes — still the right mental model

### Mode A — Act *(built, unchanged in spirit)*
One utterance → structured payload(s) → write(s). Now supports multiple actions per utterance (Phase F).

### Mode B — Retrieve & Synthesize *(built)*
All the query tools, `general_question`, `query_projects`. Genuinely works now, not aspirational.

### Mode C — Observe & Initiate *(built, in a specific and deliberate shape)*
Three daily crons: the brief (scheduled digest), Canvas sync (scheduled pull), and intention review (scheduled *judgment* — not a fixed check-in, a per-item "is today the moment" decision that defaults to silence). This last one matters: the original v1.1 framing assumed Mode C meant "runs on a schedule," but the actual requirement that emerged was **runs on a schedule, decides per-item whether to actually say anything, and never bundles into one digest** — a real design constraint, not an implementation detail. See §7 below.

**The interactive threads feature (deep-thinking → clarify → plan) sits across B and a new territory:** it's Retrieve & Synthesize that can *escalate* into a tracked, ongoing thing (a project) with its own future Mode C behavior (deadline-cascade checks). This wasn't anticipated in v1.1's framing and is worth naming as its own pattern: **Mode D — Escalate & Track**, if it recurs elsewhere (it likely will — this same shape probably fits notes-that-become-projects, or a nudge that becomes a real commitment).

---

## 3. The spine — status update

Ranked as in v1.1, updated:

### S1. Read path — ✅ done
Every domain has a query tool. Result budgets are respected (limits on notes/memories/pending items). Synthesis-style prompting is standard now, not novel.

### S2. Two-way sync — still not built, and lower priority than v1.1 assumed
The original reasoning ("Google is written to and never read from, silent divergence") turned out to be less urgent in practice, because the query tools read **live from Google**, not from Supabase's copy. Supabase's task/event rows are mostly used for idempotency (`google_task_id`/`google_event_id` uniqueness) and project linkage (`project_id`, `sequence_order`), not as the thing the user actually queries. Revisit if something starts depending on Supabase's completion-status field specifically.

### S3. Background execution — ✅ done
**Corrected Aug 9: ten schedules, not four** — `web/vercel.json` is the authority and `tests/api-routes.test.js` checks every one against a job the handler actually knows, and against the user's real timezone so a "morning" job cannot land at midnight. All of them are behind a single dynamic route (`/api/cron/[job]`) because Hobby allows 12 serverless functions and the project sat at exactly 12; a dynamic segment counts as one.

The cron *ordering* is load-bearing and documented in that test: completions and deletions reconcile before nudges are decided, metrics roll up before the observer reads them, and the graph is rebuilt before the detectors walk it. A detector can only walk edges that already exist.

`waitUntil` (`@vercel/functions`) is the second background primitive: cron for *scheduled* work, `waitUntil` for *request-triggered-but-slow* work that shouldn't block the response (deep-thinking's ack-then-analyze pattern).

### S4. Scalable tool routing — ✅ done
Native OpenAI tool calling, ~13 tools now. The predicted payoff (adding a tool is just a schema entry + router case, no prompt engineering) has held up repeatedly — every tool added since Phase F took minutes, not a prompt-tuning session.

### S5. Output surface — ✅ resolved differently than v1.1 predicted
v1.1 said "no web app yet, cron → Supabase → Shortcuts pull." That held for exactly one feature (the morning brief) before the interactive-threads requirement (a genuine back-and-forth conversation, dictated input, tap-to-play output) made a real web app unavoidable — Shortcuts fundamentally cannot do that interaction. Built as a **separate Vercel project** from the API backend, deliberately, so frontend iteration never risks the working backend. Passphrase-gated at the frontend; the backend API is separately gated by `API_SECRET` (see §6).

**Corrected Aug 9 — true push is built and live.** Pushcut was researched and declined *on cost*, and the conclusion drawn at the time ("proactive means the phone pulls when you next open the dashboard") was superseded within days: Web Push is free, so it was built directly — VAPID keys, `push_subscriptions`, `lib/push.js`, a service worker, and an interruption budget in `lib/settings.js` deciding what is allowed to reach the phone at each dial setting. The remaining constraint is iOS's, not ours: Web Push requires the PWA be installed to the home screen first.

The deeper point this section got wrong is worth keeping: *declining a paid solution is not the same as declining the capability.* The reasoning stopped at "the vendor costs money" rather than continuing to "is there a free primitive that does this", and the answer was yes.

### S6. Retrieval-based memory — ✅ built, and it taught the most important lesson in this document
Semantic retrieval via pgvector + `match_memories()`, with a blanket-top-N fallback at every failure point.

**The lesson isn't the feature, it's how it failed.** The migration was applied and the code was deployed, and it did nothing at all for days: no memory had been embedded, so the RPC returned zero rows for every query — and zero rows is *truthy*, so it passed the error guard and fell through to a blend step that handed every reasoning call four memories instead of twelve. No error. No log. The system reported itself healthy the entire time.

Generalise this: **a migration being applied is not the same as a feature being active, and graceful degradation without a health signal is indistinguishable from working.** Every "falls back safely" branch in this codebase is also a place the system can lie about itself. `lib/schema.js` now exists to ask the database directly rather than trusting a document — and it reports "applied but inert" as its own distinct state, because that is the state that looks healthiest and isn't.

### S7. Entity graph — ✅ built, and it is now the core of the product
**Corrected Aug 9.** This section said the graph had "partially emerged, not deliberately built" and advised revisiting the generic link-table idea only if a many-to-many relationship showed up. It was superseded almost immediately: `entity_links` was built deliberately (`docs/schema-islands.sql`), and the polymorphic table was the right call for the reason v1.1 originally gave — a foreign key per pair means a migration every time two domains learn to see each other.

The thing worth recording is what took longest to notice. The graph was **written for weeks before anything could read it**: `neighbours()` had exactly two callers, both inside one detector, and no tool, query, page or context assembly could ask the graph anything. It was a real graph and an unreadable one. The read side — `walk()`, `describeNeighbourhood()`, `resolveReference()` — landed Aug 9.

Generalise it: **a data structure with no read path is not built, however correct its writes are.** Ship the reader with the writer, or the writer is a lie the schema tells.

Full definition in `PersonalOS-Knowledge-Architecture.md` §3.

### S8. Observability — partially done
Failure logging solid since Phase A. Token/cost-per-call logging still not built — the builder explicitly declined it, preferring to watch the OpenAI dashboard directly. Don't build this unprompted either; it was a real decision, not an oversight.

---

## 4. What actually got built, vs. the v1.1 feature list

Most of v1.1 §4's analysis held up well. Notable deltas:

- **Adaptive Memory System** — still mostly future work (S6 not built), but the "second LLM pass to decide what's worth remembering" problem got partially sidestepped: `save_intention`'s broad-capture design means intentions get saved liberally at write time, and the *judgment* (is this worth surfacing) happens later, per-item, at read/review time — not at capture time. This pattern (capture liberally, judge later) is worth reusing if memory retrieval gets tackled.
- **Intelligent Calendar Management** — the "propose, don't execute, for destructive actions" pattern v1.1 flagged as a new interaction type is now real: the interactive-threads flow (propose a plan → user confirms → then it acts) is exactly this pattern, generalized beyond calendar.
- **Deep Thinking Project Workflows** — built, and it forced exactly what v1.1 predicted (the jobs-table-shaped problem, solved via `waitUntil` instead of a literal jobs table; the "Shortcuts can't present 1000+ words usefully" problem, solved via the web dashboard).
- **Financial Intelligence, Relationship Management, Location Intelligence** — ~~none started~~ **all three built** (corrected Aug 9). Finances via SimpleFIN at $15/yr with a 12h cache; relationships as a real `people` table with staggered check-ins and recurring date reminders; location continuously via Overland, with places recognised from repeat visits and the timezone following the user. Each of the "stated prerequisites" this section listed turned out to be answerable in an afternoon once the spine existed — which is the same pattern S1–S4 showed, and is worth trusting next time a capability looks blocked.

---

## 5. Cost & model strategy — now real, not aspirational

v1.1 recommended tiered model selection "invoked deliberately." That's now implemented and the builder has granted **standing discretion** to adjust it without asking.

**The tiers live in `lib/models.js`, not in twenty separate string literals.** Call sites name the tier by what the call *does* (`MODELS.ROUTER`, `MODELS.EXTRACT`, `MODELS.JUDGMENT`, `MODELS.DEEP`, `MODELS.EMBEDDING`), so re-tiering a whole class of work is a one-line edit and a provider deprecation is not a twenty-file sweep. A test in `tests/contract.test.js` fails if anything hardcodes a model string again.

**Corrected Aug 9: the specific model ids that used to be listed here are deleted rather than updated.** They had already drifted (`gpt-4o-mini` was named as the routing tier long after it stopped being it), and a list of ids in prose is a second source of truth that can only ever be wrong later. **`lib/models.js` is the policy.** Read it; it explains each tier by what the call does rather than by what it costs.

The one real, unaddressed cost risk is unchanged: `reviewIntentionsForNudges()` calls the model **once per open intention, every day, indefinitely**, until an intention is resolved. Seven intentions today. It scales linearly with however many "someday" items accumulate unpruned.

One cost decision was made Aug 9 and is worth recording because it is the pattern to copy. `lib/money.js` takes a `classifyUnknown` flag that defaults to **off**. The money page opts in — the breakdown is the whole point of that page — while `lib/signals.js`, which rides in every reasoning call, leaves it off. It costs nothing in accuracy, and not by compromise: the only categories that move a total are decided by rule before any model runs, so rules-only and rules-plus-model produce identical `spent`, `earned` and `transferTotal` figures. **Pay for precision where it is read, not where it is carried.**

The one real, unaddressed cost risk: `reviewIntentionsForNudges()` calls the model **once per open intention, every single day, indefinitely**, until an intention is resolved or dismissed. This scales linearly with however many "someday" intentions accumulate unresolved. Not yet a problem at current volume; worth watching if the intentions list grows large and stays unpruned. The builder has chosen to self-monitor via the OpenAI dashboard rather than build in-app cost tracking (S8) — respect that decision, don't build spend-visibility features unprompted.

---

## 6. Privacy & security posture — mostly unchanged, one addition

Still true from v1.1: service key bypasses RLS (fine, server-only, single-user), never send secrets/tokens to the LLM, `activity_logs` stores full input/output (consider redaction if genuinely sensitive data starts flowing through).

**Updated:** the web frontend has app-level passphrase auth, and **the backend API is now authenticated too** (`API_SECRET`, checked via `x-pos-key` in `lib/auth.js`, confirmed set in production). Both surfaces are covered. `requireAuth` stays dormant-when-unset by design — so the Shortcut and the server can be switched over independently — but it is loud about it in the logs, and cannot be satisfied by a guessable placeholder (see the cron-auth bug fixed in `api/cron/[job].js`, same pattern).

---

## 7. A design principle that emerged this session, worth stating explicitly

**Judgment over schedule, for anything proactive.** The nudge system's defining requirement wasn't "check daily" — it was "decide, per item, using real judgment, whether today is actually the moment, and default to silence." A fixed cadence (even a smart-sounding one like "check weekly") was explicitly rejected in favor of this. Apply this same lens to any future Mode C feature: the question is never just "how often should this run," it's "what does *this specific instance* need, decided fresh each time." This is also why the interactive-threads system stores diff summaries per turn instead of the full document each time — the same instinct (don't repeat what hasn't changed, only surface what's new/different) shows up at the UI layer too.

---

## 7b. Output surfaces, revised (Aug 7)

The Shortcut no longer speaks. It used to end in an iOS notification echoing the
shortcut's name and the raw body of the HTTP response — which confirmed the
request arrived and almost nothing else: it could not name what was created, it
could not link to it, and a question came back as JSON in braces.

The app now owns the reply (`lib/captureNotify.js`). Every capture pushes a
notification that says what actually happened in plain language and deep-links
to the artefact itself — the Google Calendar event, the Gmail draft, the
exported Doc — falling back to the relevant dashboard page when there is no
external artefact.

Three consequences worth stating, because they are load-bearing rather than
incidental:

- **Every exit path in `/api/capture` must notify.** With the Shortcut silent
  this push is the *only* reply, including for a question (where the body is the
  entire answer) and for a failure (where silence would make the capture look
  like it never arrived). All four return paths notify, and a test asserts no
  tool can capture silently.
- **Capture confirmations use unique tags; the digest uses a stable one.** The
  digest replaces itself because the budget is one message a day. Three captures
  in a row are three separate things, and a shared tag would hide two of them.
- **`capture_confirmation` sits at the `digest` tier** — the lowest that pushes
  at all. It is the app answering him, not interrupting him, but `silent` still
  has to mean silent or the dial is only a suggestion.

Reading the inbox landed alongside this (`readInbox` / `reviewInbox` in
`tools/gmail.js`), which is the first genuinely passive input the system has had
since location. It requests `format: "metadata"` — headers and Gmail's snippet,
never message bodies — and writes nothing to memory on its own, because an inbox
is full of other people's assertions and treating those as facts about the user
is how a memory store fills with things that were never true.

---

## 7c. The signed-out surface, and motion (Aug 7)

**The gate now redirects to `/welcome`, not `/login`.** The link gets sent to
people who have no passphrase and never will. A bare password field tells them
nothing, so the door is now a scrolling tour of what the system does
(`web/app/welcome/`), with `/login` still reachable from it for the one person
who can actually get in.

Three constraints on that route, all load-bearing:

- **It is prerendered and reads nothing.** It is the only route outside the
  session check, so it must not be able to reach Supabase, the bank connection
  or Google even by accident. Every figure on it is written into its own source
  and labelled illustrative. A test walks the imports in `web/app/welcome/` and
  fails if any of them reaches live data.
- **It must not be behind the gate it redirects to.** `welcome` is excluded from
  the proxy matcher. Without that exclusion the gate redirects to a page that
  redirects to the gate — and the symptom is not an error, it is a browser that
  spins on the one URL the app exists to be shared as. There is a test for this.
- **It carries no personal data, and that is a standing rule.** Every name,
  place, merchant and figure on the tour is invented. The link is handed to
  people who are not the user, and the repository is public, so anything real on
  that page is disclosed twice over. The same sweep removed identifying detail
  from code comments and these docs.
- **It describes techniques, not vendors.** The "how it is built" section names
  the mechanisms (natural-key upserts, VAPID push, tiered model routing,
  suspense-per-route) without listing the products underneath them.
- **The tour opens with a full-screen title sequence** (`welcome/Intro.js`),
  which assembles a graph and resolves it into the wordmark. It is hidden in the
  markup and revealed by script, plays once per session, is skippable by click
  or key, and never runs under reduced motion. The session flag is written when
  it *finishes*, not when it starts, so an interrupted run replays instead of
  being silently consumed.
- **No scene loops.** Each one plays once and holds its finished state. The
  first version looped with a delay between passes, which meant the panel sat
  blank for seconds and read as broken to anyone who scrolled to it late.

**Motion goes through `web/app/motion.js`, never anime.js directly.** anime.js
(4.x, ~18KB gzipped, its own chunk) drives staggered card entry on the dashboard
and money pages, count-ups on figures, the donut drawing itself, and the tour's
scenes. The wrapper exists for three reasons:

- **Reduced motion has to be enforced in JavaScript.** `globals.css` neutralises
  every CSS animation under `prefers-reduced-motion`, but anime.js writes inline
  styles from a rAF loop and that rule cannot touch it. Every helper checks the
  media query itself and applies the settled state instead.
- **Hidden must never mean lost.** Entrance animations start at `opacity: 0` via
  the `.pos-reveal` class, so there are three ways that could strand content on a
  blank page: reduced motion, no scripting, and no `IntersectionObserver`. All
  three have explicit overrides — a media query, a `<noscript>` style in the
  layout, and a feature check. A test asserts the first two still exist.
  - The `<noscript>` one is the trap: it cannot live in a media query, and
    without it the *entire app* renders blank with scripting off.
  - It was briefly a 2.5-second timer instead of a feature check, which was
    worse than useless — on any page taller than the viewport it revealed every
    card below the fold before the reader had scrolled to it.
- **Animation must not become a second opinion about a number.** `countUp`
  interpolates toward a value the server computed and writes that exact value on
  completion, never the last animated frame. The pre-hydration text is the
  server's own formatted string.

---

## 8. Open decisions

### ✅ Resolved since v1.1
1. Notes vs. memories — confirmed as separate (notes = things to look up, memories = facts about the user, intentions = a third, newer category for forward-looking statements).
2. AI spend ceiling — explicitly declined a hard number; self-monitored via OpenAI's dashboard, auto-refill off (hard ceiling by construction).
3. Brief cadence — resolved, daily ~6am Pacific (shifts with DST since the cron schedule is UTC-based — watch this, and watch `profiles.timezone` needing a manual update around 2026-08-08/09 when the user changes timezone).
4. Location tracking — explicitly declined, not deferred.
5. Push notifications — Pushcut researched and declined on cost; native notification + Home Screen icon is the accepted fallback.

### ✅ Resolved since (Aug 6)
6. Backend API authentication — **live**, `API_SECRET` set in production.
7. Live web search integration — **built**, on the Responses API's hosted `web_search` tool (`tools/research.js`), backing `research_query`, plan-building materials, and Docs export.

### ✅ Resolved since (Aug 7)
8. Whether the generic `entity_links` table (S7) is ever actually needed — **yes, and it is built.** Direct FKs stopped being sufficient the moment anything needed to ask "what else touches this", which is every detector in `tools/islands.js`.

### ✅ Resolved since (Aug 9)
9. Whether an insight may be built from another insight's finding — **no.** Findings may be *grouped* by a shared entity before phrasing, because grouping is arithmetic. One finding may not be *derived from* another's output: a chain of inferences starts sounding more certain than any link in it, and the "compute in code, model only phrases" discipline is exactly what breaks first. Recorded in `PersonalOS-Knowledge-Architecture.md` §8.

### ⬜ Still open
10. Sync conflict rule (S2) — moot until two-way sync actually gets built, which is now lower-priority than v1.1 assumed.
11. How much of the entity graph should be user-editable. Now more pressing than before, since the graph has a read side and a wrong edge is therefore visible. A UI for editing edges is a second source of truth the automatic extraction has to reconcile with — decide the reconciliation rule before building the UI.

---

## 9. Principles & anti-patterns — carried forward, one addition

Everything from v1.1 still holds (boring over clever, infrastructure before features, manual-entry features get abandoned, synthesis quality is a data problem, silence is the default failure mode of background jobs).

**New, learned the hard way this session:** *a client-side timeout does not mean a server-side write failed.* For anything that writes to an external system (Google Tasks/Calendar especially), a timed-out request may have completed anyway — check actual state before retrying, or the retry itself becomes the bug (this exact thing happened: a timed-out `buildPlan` call had actually succeeded, and the retry created a second full project with a second set of real Google tasks/events).

**New, Aug 9 — three anti-patterns, all the same shape.** Each was found by an audit rather than by anything failing, which is the point:

- *A structure with no read path is not built.* The entity graph was written nightly for weeks and could not be queried by anything.
- *A guard that does not cover what it protects is worse than no guard, because it is believed.* `lib/schema.js` probed 8 of 10 migration files and reported full health.
- *A function that returns the same value for "nothing to report" and "the query is broken" will eventually be broken and silent.* `projectSignal` was dead for its entire existence.

The common thread is that **none of these produced an error, a failed test, or a wrong-looking screen.** The system reported itself healthy throughout. That is the failure mode this project should be most afraid of — the pre-mortem calls it silent degradation, and it is the reason `lib/schema.js` reports "applied but inert" as a distinct state, and the reason every new guard added since ships with a test that fails when the guard stops covering something.

---

*Update this document when an open decision resolves or a phase completes. It should stay the answer to "why is it built this way," not a changelog — the handoff doc is the changelog. Both were substantially rewritten 2026-08-04; treat prior versions as historical context only.*
