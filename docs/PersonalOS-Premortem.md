# PersonalOS — Pre-Mortem

**Date:** August 5, 2026
**Method:** Assume it is August 2027 and PersonalOS is dead. Work backwards from the obituary.
**Scope:** Full read of `api/`, `lib/`, `tools/`, `web/`, `docs/` (~15,000 lines of source).

This document is deliberately harsh. It is not a review of code quality — the code
quality is genuinely good, the comments are unusually honest, and the docs are better
than most funded startups keep. It is an inventory of the things that will kill this
project anyway.

Read §1 for what fails. Read §2 for what to do about it. Read §3 — the rebuild prompt —
if you are an AI being asked to restructure this system.

---

## 0. The one-paragraph obituary

> PersonalOS died in early 2027. Not from a bug. It died because it was a single-tenant
> system with the tenancy assumption welded into 52 database functions and 5 schema
> files, so it could never be shared; because its schema lived in five SQL files that
> a human pasted into a dashboard by hand, so nobody could ever say what version
> production was actually running; because every feature that depended on a
> not-yet-run migration degraded silently instead of loudly, so the system reported
> health it did not have; because a per-item daily LLM call over a table designed to
> accumulate liberally turned a $7/month hobby into an unbounded bill; and because
> after eleven feature areas were built in four days, the thing it needed most —
> someone using it every day for a month — never happened.
>
> The proximate cause of death was the builder opening the dashboard, seeing an empty
> observer, a stale correlation engine, and a nudge about an intention from four months
> ago, and not opening it again.

---

## 1. Failure modes

Ranked by *probability × lethality*, not by category. Categories are tagged.

### 1.1 — CRITICAL: Single-tenancy is welded in, not layered on

**Category:** database design, product

`lib/supabase.js` exports one module-scope client built from `SUPABASE_SERVICE_KEY`.
The service key bypasses Row Level Security entirely. That is a correct and defensible
choice for a single-user server-side system — and it is also the load-bearing
assumption that makes the whole thing unshippable to a second person.

Concretely:

- **No table in any of the five schema files has a `user_id`, `owner_id`, or `tenant_id`
  column.** Not `memories`, not `intentions`, not `people`, not `daily_metrics`
  (which is keyed on `day` alone — a primary key that can only ever hold one human's
  history), not `places`, not `push_subscriptions`, not `practice_sessions`.
- `lib/profile.js:getProfile()` is `.from("profiles").select("*").limit(1).single()`.
  The comment says *"When multi-user arrives, this is the only function that changes."*
  That is not true, and it is the most dangerous sentence in the codebase. Every one of
  the ~52 exported functions in `tools/database.js` queries an unscoped table.
  `getOpenIntentions()`, `getMemories()`, `getAllPeople()`, `getActiveProjects()` all
  return *everything in the table*.
- The module-scope client also means there is no request-scoped context to attach a user
  to even if you wanted to.

**How it kills the project:** the moment a second person is added — a friend, a beta
user, a co-founder testing it — this is not a migration. It is a rewrite of the data
layer, every tool, every cron, and every schema, executed against a live database that
holds the only copy of the moat (accumulated personal history). Most projects do not
survive that. The likely real outcome is milder and worse: it never gets attempted,
PersonalOS stays a party trick that only runs on one laptop's env vars, and it quietly
stops being a project.

**This is the single highest-leverage thing in this document.**

---

### 1.2 — CRITICAL: Auth fails open, in two places, one of them guessably

**Category:** privacy, technical

**(a) `lib/auth.js:32`**

```js
const configured = process.env.API_SECRET;
if (!configured) {
  return true;   // <-- every request passes
}
```

The dormancy is documented and was a deliberate rollout decision (the iOS Shortcut has
to start sending the header at the same moment the server starts requiring it, and the
Shortcut can only be edited by hand on a phone). That reasoning is sound *for a
migration window*. It is not sound as a steady state, because the failure mode is
invisible: a new Vercel project, a rolled-back env var, a preview deployment, or a
`vercel env rm` typo silently makes the entire API public. And the API is not read-only —
`/api/capture` writes to Google Calendar and Google Tasks, deletes tasks, and spends
OpenAI credit; `/api/[resource]` reads memories, finances, deep-thinking transcripts,
location, and relationships.

**(b) `api/cron/[job].js:150` — worse, and an actual live bug**

```js
if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return res.status(401).json({ error: "Unauthorized" });
}
```

If `CRON_SECRET` is unset, this template literal evaluates to the string
`"Bearer undefined"`. Anyone who sends `Authorization: Bearer undefined` is
authenticated. That is not a theoretical fail-open — it is a *fail-open with a
publicly guessable credential*, and it is the first thing anyone probing a Vercel app
would try.

What an attacker gets: unbounded triggering of `reviewIntentions`, which is the most
expensive job in the system (one LLM call per open intention), sends push notifications,
and on Sundays runs `regenerateBio()` — explicitly described in the codebase as *"the
one destructive operation in this system."*

**(c) No rate limiting anywhere.** `/api/capture` is an unauthenticated-by-default
endpoint that invokes an LLM and writes to third-party calendars. There is no per-IP
limit, no daily call cap, no circuit breaker.

**(d) A credential in a query string.** `/api/ingest/location?key=...` — the code
comments correctly identify this as bad and correctly argue the mitigation (a separate,
narrowly-scoped token). The mitigation is right. The residual risk is that Vercel access
logs now permanently contain a working credential, and there is no rotation story.

---

### 1.3 — CRITICAL: Schema drift is invisible by design

**Category:** maintainability, database design

There are five schema files in `docs/`:

| File | Applied to production? |
|---|---|
| `schema-additions.sql` | probably |
| `schema-settings.sql` | **documented as NOT run** |
| `schema-memory-retrieval.sql` | **documented as NOT run** |
| `schema-practice.sql` | unknown |
| `schema-people.sql` | unknown |

There is no migration runner, no `schema_migrations` table, no ordering, no checksums,
and no way to ask production what it is actually running. The state of the database is
tracked in prose, in a handoff document, by a human.

The codebase's response to this is per-feature graceful degradation, and it is genuinely
well-engineered — `tools/memory.js:missingColumnOrFunction()` checks four Postgres and
PostgREST error codes plus two regexes; `lib/settings.js:missingTable()` handles
PGRST205. Nothing crashes.

**That is the problem.** The system is built to feel healthy while being partially
inert. Right now, per the handoff doc:

- Retrieval-based memory is "code done and deployed" — and is silently running the old
  blanket top-N fallback, because the migration was never run. The single most important
  cost-control mechanism in the system is off, and nothing says so.
- The interruption dial — the control that enforces the single most important product
  decision ("a muted app kills every other feature") — cannot persist, and defaults to
  `digest_plus_urgent` in memory.

Each new feature adds another bespoke fallback branch. The union of those branches is a
system whose actual behaviour nobody can state without reading every file. That is the
definition of unmaintainable, and it arrives quietly.

---

### 1.4 — CRITICAL: There are no tests. At all.

**Category:** technical, maintainability, AI limitations

`package.json`:

```json
"scripts": { "test": "echo \"Error: no test specified\" && exit 1" }
```

`dev/` contains eleven scripts. None of them assert anything; they print and exit.

This matters more here than in a normal codebase, because the control flow is an LLM
choosing among **20 side-effectful tools**, several of which delete real data in Google
Calendar and Google Tasks. The correctness of the system is a property of a prompt
string in `api/capture.js` plus 20 JSON schemas in `lib/toolDefinitions.js`, and that
property is currently unmeasured.

The project already learned this lesson and wrote it down. From the handoff doc, trap #5:

> *Single-sample evals hide flakiness. "Move my dentist appointment to Thursday" passed
> once and still failed in production. Run routing evals 4× per phrase, and have the eval
> parse the real prompt out of `api/capture.js` so it can't drift.*

**No such harness exists in the repository.** The lesson was learned, documented, and
not encoded. That is the exact shape of knowledge that evaporates when a project pauses
for two months.

Similarly undefended by tests: trap #1 (Google Tasks date-vs-instant, "bitten twice"),
trap #3 (never let a model do arithmetic then narrate it), trap #4 (client timeout ≠
server failure).

---

### 1.5 — HIGH: Cost scales with *accumulated* state, not with usage

**Category:** cost scaling

`tools/nudges.js:reviewIntentionsForNudges()` runs one `gpt-5.6-terra` completion **per
open intention, per day, indefinitely**, plus one embedding call each for the per-item
memory slice.

The architecture doc names this risk. What it doesn't connect is that it collides
head-on with a design principle stated two sections earlier — **"capture liberally, judge
later."** `save_intention` is deliberately built to over-capture. Nothing prunes.
Nothing expires. An intention stays open until explicitly resolved or dismissed, and
the dashboard offers no bulk triage.

The arithmetic: 100 open intentions × 30 days = **3,000 reasoning calls a month** for a
feature whose correct output, by explicit design, is *silence* on almost every one of
them. The cost of the system becomes a function of how long it has existed and how
sloppily things were captured — the two variables that only ever go up.

Compounding:

- `buildRichContext()` is rebuilt from scratch on every reasoning call: bio + memories +
  10 bodyweight rows + `buildSignals()`. `buildSignals()` calls **SimpleFIN live**, so
  every nudge evaluation is also a banking API round-trip.
- Retrieval memory — the actual fix for context bloat — is inert (§1.3).
- There is no spend ceiling in code. "Auto-refill off" is a *hard stop*, not a budget.
  Its failure mode is the entire system going dark mid-month with no warning and no
  degraded tier — the worst possible shape for a habit-forming product.
- The daily cron fans out: completions → nudges (O(n)) → cascade → relationships (O(n)) →
  metrics → observer → news framing (per story) → weekly bio regen. All inside a
  60-second Vercel function.

---

### 1.6 — HIGH: Twenty hardcoded model strings, no registry

**Category:** API dependencies, maintainability

`grep 'model: "'` returns 20 hits across 20 files: `gpt-5.4-mini` (×6),
`gpt-5.6-terra` (×12), `gpt-5.6-sol` (×1), plus `gpt-4o-mini-tts`/`tts-1` in `web/` and
`text-embedding-3-small` in `lib/embeddings.js`.

The tiering policy documented in the architecture doc (mini for routing/queries, terra
for judgment, sol for the opening deep-thinking pass) exists **only as a convention that
happens to be spelled the same way in twenty places.** There is nothing to read to know
the policy, nothing to change to change it, and nothing to fail if one file drifts.

An OpenAI deprecation notice becomes a 20-file sweep with no test to catch a miss.
Given §1.4, a missed one surfaces as a 500 in production on whichever tool is least used —
which, in a system where most background jobs correctly default to silence, might be
never noticed at all.

---

### 1.7 — HIGH: External writes are not idempotent

**Category:** technical, API dependencies

The single most expensive bug this project has hit is documented as trap #4:

> *A timed-out `buildPlan` had actually succeeded, and the retry created a second full
> project with a second set of real Google tasks/events.*

The mitigation shipped was heuristic — `findRecentDuplicateEvent()` and
`findRecentDuplicateTask()` in `tools/database.js`, which look for similar recent rows.
That reduces the blast radius. It does not fix the class. There are no idempotency keys,
no request IDs, no write-ahead intent records, no "did this operation already run"
ledger.

Every multi-write path is exposed: `buildPlan` (the known one), `syncCanvasAssignments`,
`syncTaskCompletions`, and any future Gmail draft feature. `maxDuration` is 60s;
`buildPlan` was measured at ~23s for 30 tasks *before* concurrency was added, so the
margin is real but not large, and the failure mode on exceeding it is exactly the one
that already bit.

---

### 1.8 — RESOLVED: The Vercel Hobby cron limit concern

**Category:** technical

**Status: checked directly against the live account, not assumed either way.**
`vercel.json` declares **four** cron jobs. Whatever theoretical limit applies to a
Hobby account, it is not binding on this one: `npx vercel crons ls` shows all four
registered, and Supabase has independent same-day evidence of each firing on its own
schedule with no manual trigger (a `news_items` row created ~30-50 minutes after its
0 11 * * * schedule, a `briefs` row ~1 minute after 13:00, a `daily_metrics` rollup
~50 minutes after 12:30). The lag is consistent with Hobby's documented "loose timing,
may fire within the hour," not a dropped job.

Since this was resolved, `syncNews` and `reviewIntentions` have each gained additional
work riding on the same schedule (debate-topic framing, relationship date-reminder
materialisation, the Fund's now-removed daily run) rather than new cron entries — the
right pattern, established here for exactly this reason: adding a fifth `vercel.json`
cron entry is the thing that would actually need re-verifying, not adding more work to
an existing one.

**If a fifth distinct schedule is ever genuinely needed** (not just more work on an
existing one), re-run this check rather than trusting this paragraph — `npx vercel
crons ls` plus a same-day Supabase timestamp is a five-minute check, not a research
project.

---

### 1.9 — HIGH: Two deployment targets, one of which does not deploy

**Category:** maintainability

- The API backend auto-deploys on push to `main`.
- `web/` requires a manual `cd web && npx vercel --prod --yes`.

They are coupled: `web/` calls the backend via `BACKEND_URL` + `BACKEND_KEY`, and
`api/[resource].js` is the contract. There is no shared schema, no version handshake,
no contract test. A backend response-shape change ships in seconds; the frontend that
consumes it ships whenever a human remembers to run a command in a subdirectory.

Also: `OPENAI_API_KEY` is now required on **both** projects (the `web` project needs it
for `/api/tts`). Env vars have started duplicating across deployment targets, with no
single source of truth for what each project needs. The handoff doc already records the
first casualty — `/api/tts` returning 501 because the key wasn't set on `web` yet.

---

### 1.10 — MEDIUM/HIGH: Built far faster than it has been lived in

**Category:** product — *and the most likely actual cause of death*

The handoff doc says this itself, and it is the most valuable sentence in the repo:

> *This is a system that has been built far faster than it has been lived in.*
> 7 memories · 1 intention · 0 projects · 2 deep thoughts

Eleven feature areas were built across four days. Every proactive feature — the observer,
the nudges, the correlation engine, the metrics rollup — is a function that needs weeks
of accumulated history to produce anything other than silence. That is correct
behaviour and it is also, from the user's chair, indistinguishable from a broken app.

The failure sequence is well understood in consumer software:

1. Build feature #12 while feature #1 has never had a full week of real input.
2. Open the dashboard. The observer is quiet (correct). The correlations are absent
   (correct). The nudge is about an intention captured months ago (correct, and
   annoying).
3. Conclude, wrongly but reasonably, that it isn't working.
4. Stop opening it.
5. The data stops accruing, which guarantees the proactive features stay silent, which
   confirms step 3.

There is currently no instrumentation that would distinguish "the observer correctly had
nothing to say" from "the observer has not run in nine days." Nor is there any
first-run/low-data experience that sets the expectation of a warm-up period.

---

### 1.11 — MEDIUM: The input funnel is one hand-edited iOS Shortcut

**Category:** user experience, mobile

Every write into the system originates from a single iOS Shortcut that POSTs to
`/api/capture`. That Shortcut:

- can only be edited by hand, on the phone, by one person;
- is not in version control;
- is the reason backend auth cannot simply be switched on (documented in `lib/auth.js`);
- has no retry, no offline queue, and no error surface beyond whatever the Shortcut
  speaks aloud.

If OpenAI is slow or down, `api/capture.js` returns a 500 and the utterance is **gone**.
A voice-first capture system that loses input on a transient upstream failure trains the
user not to trust it, which is fatal for a capture tool specifically — the whole value
proposition is "say it and forget it."

---

### 1.12 — MEDIUM: Mobile is built on the surface Apple most constrains

**Category:** mobile experience

The proactive premise depends on: web push to an iOS PWA, plus Overland for location.

- iOS web push requires the site be added to the Home Screen, and the subscription is
  destroyed if the icon is removed. There is no recovery flow if that happens silently.
- The PWA has no background execution. "Proactive" still fundamentally means "the phone
  pulls when the user next opens it," exactly as the v1.1 architecture doc predicted.
  Push narrows the gap; it does not close it.
- Overland is confirmed dead after a swipe-quit, with no app-level fix possible. It is
  correctly flagged as a proof-of-concept, but `daily_metrics.places_visited` and
  `minutes_at_gym` — inputs to the future correlation engine — depend on it. **The
  correlation engine will be trained on data with a systematic, invisible gap
  correlated with phone usage habits.** That is worse than no data: it is data that
  will produce confident wrong conclusions.
- `web/` is a Next.js 16 app using `proxy.js` (the renamed middleware). Server-side
  rendering of a dashboard behind a cookie check, on a phone, on cellular, is a
  cold-start-sensitive path with no offline shell despite the service worker being
  present for push.

---

### 1.13 — MEDIUM: AI failure modes are defended by prompt, not by architecture

**Category:** AI limitations

The discipline in this codebase is genuinely above average — "compute in code, hand the
figure to the model as fact" is stated repeatedly and mostly followed. But the
enforcement is cultural:

- **Shape trust.** Every judgment tool uses `response_format: { type: "json_object" }`
  and then reads `.should_nudge` / `.message`. That guarantees *valid JSON*, not *the
  expected keys*. A model that returns `{"nudge": true}` produces `undefined`, which is
  falsy, which means the nudge silently never fires — indistinguishable from correct
  silence. **This is the single most dangerous interaction between "silence is the
  default" and "unvalidated model output" in the system.** There is no schema
  validation anywhere.
- **Hallucination guards are prose.** "Do not invent patterns below 14 days of history"
  lives in a prompt. The correlation engine is the first feature where a fabricated
  claim permanently costs trust, and the doc says exactly that — but the 14-day floor
  is not enforced in code.
- **Prompt injection.** `tools/news.js` pulls RSS from BBC/NPR/WSJ and feeds headline +
  description into a model that generates debate framings. `tools/research.js` does live
  web search. Untrusted third-party text now reaches models that, elsewhere in the same
  system, drive tool calls. The surfaces are currently separate. Nothing structural
  keeps them that way.
- **No output logging of model reasoning for the judgment calls**, so a bad nudge can't
  be diagnosed after the fact beyond the final message.

---

### 1.14 — MEDIUM: Privacy — unbounded retention of the most sensitive data

**Category:** privacy

- `activity_logs` stores **full input and output of every call**, forever. That now
  includes finances, GPS coordinates, relationship notes, and deep-thinking transcripts.
  There is no redaction, no TTL, no retention job. The architecture doc flags this as
  *"consider redaction if genuinely sensitive data starts flowing through."* It has.
- `location_points` is a `bigserial` table whose own schema comment says it is
  *"downsampled by a retention job rather than kept forever."* **No such job exists.**
  There is no downsampling code anywhere in the repository.
- Deletes are hard deletes. `deleteMemory`, `deleteNote`, `deleteIntention`,
  `deleteProjectRecord` remove rows permanently, against the exact data that constitutes
  the product's moat. There is no `deleted_at`, no undo, no export, and no backup.
- The one destructive scheduled operation, `regenerateBio()`, overwrites `profiles.bio`
  weekly, unattended, with "heavy preservation guards" but **no version history of the
  previous bio.** A bad regeneration is unrecoverable.

---

### 1.15 — MEDIUM: Database design debt that will calcify

**Category:** database design

- `projects.goal_id` exists **with no FK constraint** (documented, learned the hard way).
  Embedded PostgREST selects through it cannot be trusted.
- The `goals` table is created and never written to. Dead schema that a future model
  will confidently reason about.
- `people.updated_at` exists; nothing sets it. No `updated_at` triggers anywhere.
- `activity_logs`, `location_points`, `news_items` all grow without bound on a free tier
  with a hard storage cap. Hitting it is a write failure across every domain at once.
- `daily_metrics` PK is `day` — single-tenancy baked into a primary key (§1.1).
- Time is stored inconsistently by necessity: Google Tasks dates are date-strings, events
  are instants, `daily_metrics.day` is a date, everything else is `timestamptz`. Trap #1
  says this has bitten twice. It is a class of bug, not an incident.

---

### 1.16 — MEDIUM: Competitive landscape — the moat is real but undefended

**Category:** competitive

Feature-for-feature, everything here exists elsewhere: Motion and Reclaim do calendar
intelligence; Notion and Mem do notes-with-AI; Rewind and Limitless do passive capture;
ChatGPT with memory does the conversational layer; Monarch does finances.

The defensible thing is **not** any feature. It is the accumulated, cross-domain,
personal history plus a bio that regenerates from it — a compounding asset that gets
better the longer it runs and cannot be copied over from a competitor.

Which means the moat's integrity *is* the product. And today that asset has:

- no export,
- no backup,
- no version history on its single most important derived artifact (`profiles.bio`),
- hard deletes,
- and a hosting story where losing one Supabase project loses everything.

A product whose entire defensibility is accumulated history, with no backup of that
history, is one bad `delete` away from having no reason to exist.

---

### 1.17 — LOW/MEDIUM: Operational fragility

**Category:** API dependencies, technical

The request path is: iOS Shortcut → Vercel → OpenAI → Google → Supabase → SimpleFIN.
Six providers, single region, no queue, no retry layer, no circuit breaker. Only
SimpleFIN failure is explicitly caught and degraded (`financeSignal` → `null`).

Everything else propagates. `getProfile()` returning `null` on a Supabase blip silently
falls back to a hardcoded zone, which — for a user documented as changing timezone
on 2026-08-08 — means every relative date resolves hours off, quietly, with no error.

**Partly addressed 2026-08-08.** The fallback was worse than described: three files
disagreed about it (`lib/profile.js` said `America/Los_Angeles`, `lib/signals.js` and
`tools/location.js` each hardcoded `America/Chicago`), so a Supabase blip resolved dates
in one zone for the brief and another for the signals feeding it. There is now one
exported `FALLBACK_TIMEZONE` in `lib/profile.js`, set to Chicago, and no other literal.
The silent-degradation problem itself remains: a failed profile read still falls back
rather than saying so.

Related, and still open: Vercel cron schedules are UTC and do not follow that constant.
Moving from Pacific to Central pushed every morning job two hours later until the
schedules were moved by hand. `tests/api-routes.test.js` now asserts the local landing
times against `FALLBACK_TIMEZONE`, on both sides of a DST boundary, so the two cannot
drift silently — but a UTC cron still shifts an hour twice a year.

---

## 2. Solutions, in the order they should be done

The ordering principle: **do the things that make the other things safe to do.**

### Tier 0 — This week. Cheap, and each one prevents a class of failure.

| # | Fix | Kills |
|---|---|---|
| 0.1 | **Fix the cron `Bearer undefined` bypass.** Never let a template-literal `undefined` authenticate. | §1.2b |
| 0.2 | **Central model registry** (`lib/models.js`). One file names the tiers; every call site imports. | §1.6 |
| 0.3 | **`npm test` that actually runs**, using `node:test` — zero new dependencies. Encode traps #1/#3/#4 as unit tests. | §1.4 |
| 0.4 | **Schema-drift probe in diagnostics.** Actively check which migrations are live and show it on `/settings`. Turn invisible drift into a visible checklist. | §1.3 |
| 0.5 | **Run the two pending migrations** (`schema-settings.sql`, `schema-memory-retrieval.sql`) and backfill embeddings. Retrieval memory is the budget control and it is currently off. | §1.3, §1.5 |
| 0.6 | **Verify the Vercel cron limit** against the real account. Correct the architecture doc either way. | §1.8 |

### Tier 1 — This month. Structural, and each one is load-bearing for growth.

**1.1 — Introduce a tenancy seam *before* you need it.**
Do not build multi-user. Build the *seam*, while the database has 7 memories in it and
the change is trivial:

- Add `user_id uuid` to every table, defaulted to a single constant "owner" UUID.
- Replace the module-scope `supabase` export with `db(ctx)` returning a scoped query
  builder that applies `.eq("user_id", ctx.userId)` automatically.
- Thread a `ctx` object (userId, timezone, now) through `executeTool` → tools.
- Keep the service key. Keep RLS off. Change nothing about behaviour.

This is a mechanical change today and a rewrite in a year. It is the single highest-value
item in this document.

**1.2 — Real migrations.**
A `migrations/` directory with numbered, immutable files and a `schema_migrations` table.
Since PostgREST cannot run DDL, the runner can still be "print the exact SQL to paste,"
but the *ledger* must be a table the app reads. Then delete the graceful-degradation
branches and replace them with one loud startup check: *"migration 004 is not applied;
retrieval memory is off."*

**1.3 — Validate every model response against a schema.**
A tiny `parseJson(response, shape)` helper that throws on a missing key. Wire it into
every `response_format: json_object` call site. Log the raw response on failure. This
closes the "silently falsy → indistinguishable from correct silence" hole (§1.13), which
is the worst bug class in a system whose default output is silence.

**1.4 — Idempotency keys on external writes.**
Every operation that creates something in Google gets a caller-supplied key stored
before the write and checked before retry. Replace the heuristic duplicate-finders.

**1.5 — Bounded cost, enforced in code.**
- A daily LLM-call budget counter in `app_settings`; when exceeded, background jobs skip
  and log rather than spend.
- Intention lifecycle: auto-archive anything untouched for N days, with a bulk-triage UI.
  This directly bounds §1.5's O(n) growth.
- Cache `buildRichContext()` per request, and cache `buildSignals()` for ~15 minutes so
  one cron run doesn't hit SimpleFIN once per intention.

**1.6 — Retention and backup.**
- A retention job: downsample `location_points` older than 30 days, truncate
  `activity_logs` payloads older than 30 days (keep the metadata, drop the bodies).
- Version `profiles.bio` — append to a `bio_versions` table before overwriting.
- Soft-delete (`deleted_at`) for memories/notes/intentions/projects.
- A weekly export job producing one JSON blob of everything. The moat needs a copy.

### Tier 2 — Before it matters.

- Contract tests between `web/` and the backend; make `web/` auto-deploy.
- A routing eval harness that parses the live prompt out of `api/capture.js` and runs
  each phrase 4× (trap #5, finally encoded).
- Rate limiting on `/api/capture`.
- An offline queue in the Shortcut path — accept-and-ack before routing, so a slow
  OpenAI never loses an utterance.
- Enforce the 14-day history floor for correlation claims **in code**, not in a prompt.
- Isolate untrusted text (RSS, web search) from any model that can call tools.

### Tier 3 — The product one, which matters more than all of the above.

**Stop building features. Instrument use.**

The most likely cause of death (§1.10) has no technical fix. What it has is a
measurement fix:

- Track daily-active-use explicitly. Not row counts — *sessions*.
- Build a low-data mode that says out loud: *"The observer needs ~14 days of history.
  You're on day 3."* Silence that explains itself is not the same as silence.
- Add a "what did the system do yesterday" view — every job, whether it ran, and whether
  it correctly chose silence. This is the only way to distinguish §1.10's step 2 from a
  genuine outage, and it is also the antidote to §1.8 and §1.3.

Ship nothing else until the system has been used daily for four consecutive weeks.

---

## 3. The rebuild prompt

*Paste the block below into the main AI chat. It is written to be executed
incrementally, in order, without breaking a working system.*

---

> ### PersonalOS — Structural Rebuild Brief
>
> You are working on PersonalOS, a single-user personal operating system: an iOS
> Shortcut and a Next.js dashboard talking to a Vercel-hosted Node API, which routes
> natural language through an OpenAI tool-calling router into ~20 tools over Supabase,
> Google Calendar/Tasks, and SimpleFIN.
>
> **Read first, in this order:** `docs/PersonalOS-Current-State-Handoff.md` (what is
> true now), `docs/PersonalOS-Architecture-Source-of-Truth.md` (why it is built this
> way), `docs/PersonalOS-Premortem.md` (what will kill it — §1 is the failure
> inventory, §2 is the ordered fix list).
>
> **Your job is structural, not featural. Do not add features.** A pre-mortem found
> that this system's risk is concentrated in five places: welded-in single-tenancy,
> fail-open auth, untracked schema drift, zero tests, and cost that scales with
> accumulated state rather than with usage.
>
> **Non-negotiable constraints — violating any of these breaks a working system:**
>
> 1. **No public URL may change.** The iOS Shortcut is hand-edited on a phone and is
>    not in version control. `/api/capture`, `/api/data`, `/api/brief/latest`,
>    `/api/ingest/location` and the rest must keep responding at the exact same paths
>    with the same response shapes.
> 2. **Supabase DDL cannot be run from code.** PostgREST reads and writes rows; it
>    cannot create tables. Every schema change must be emitted as a `.sql` file for a
>    human to paste into the Supabase dashboard, and the code must not assume it has
>    been applied until a ledger says so.
> 3. **Vercel Hobby function budget.** The API project uses dynamic routes
>    (`api/[resource].js`, `api/cron/[job].js`, `api/ingest/[kind].js`) specifically to
>    stay under the 12-function limit. Do not add top-level files in `api/`; extend the
>    dynamic routes.
> 4. **Auth is dormant-when-unset by deliberate design**, so the Shortcut and server can
>    be switched over independently. Preserve that property — but make dormancy *loud*
>    and never let an `undefined` secret authenticate anything.
> 5. **Cost target is under $10/month, all-in.** Currently ~$7. Any change that adds
>    per-call LLM work must state its marginal cost.
> 6. **`web/` is a separate Vercel project** that does not auto-deploy. Anything you
>    change there requires `cd web && npx vercel --prod --yes`.
>
> **Work in this order. Each step must leave the system deployable.**
>
> **Step 1 — Tenancy seam (highest value; do this while the database is nearly empty).**
> Add `user_id uuid not null default '<constant-owner-uuid>'` to every table, as a `.sql`
> migration. Replace the module-scope client in `lib/supabase.js` with a request-scoped
> accessor that auto-applies the user filter. Thread a `ctx` (userId, timezone, now)
> through `executeTool` into every tool. Behaviour must not change at all — this is
> purely a seam. Verify by running the full test suite and hitting `/api/capture` with a
> create, a query, and a modify.
>
> **Step 2 — Migration ledger.** Create `migrations/` with numbered immutable files
> (move the five `docs/schema-*.sql` files in, in dependency order). Add a
> `schema_migrations` table. Add `lib/schema.js` that reads the ledger and reports which
> migrations are live. Surface it in `lib/diagnostics.js` and on `/settings`. Then
> **delete the per-feature graceful-degradation branches** (`missingColumnOrFunction` in
> `tools/memory.js`, `missingTable` in `lib/settings.js`) and replace them with one
> explicit check against the ledger, so a pending migration is a visible red state
> rather than a silent fallback.
>
> **Step 3 — Model response validation.** Add `lib/parseModelJson.js` that validates a
> parsed response against a required-key list and throws with the raw body logged.
> Apply it to every `response_format: { type: "json_object" }` call site
> (`tools/nudges.js`, `observer.js`, `debate.js`, `pitch.js`, `news.js`, `thread.js`,
> `modify.js`, `profileEvolution.js`). Today a model returning the wrong key produces
> `undefined`, which is falsy, which is indistinguishable from a correct decision to stay
> silent — this is the most dangerous bug class in the system.
>
> **Step 4 — Idempotency.** Add an `operations` table keyed by an idempotency key.
> Every write to Google Calendar/Tasks records intent before the call and checks before
> retrying. Replace `findRecentDuplicateEvent` / `findRecentDuplicateTask` heuristics.
> This closes the documented bug where a timed-out `buildPlan` was retried and created a
> second real project.
>
> **Step 5 — Bounded cost.** (a) Add a daily LLM-call counter in `app_settings`;
> background jobs check it and skip-with-log when exceeded. (b) Auto-archive intentions
> untouched for 60 days and add bulk triage to `/data` — `reviewIntentionsForNudges()`
> currently makes one model call per open intention per day forever, against a table
> designed to over-capture. (c) Memoize `buildSignals()` for 15 minutes so one cron run
> makes one SimpleFIN call, not one per intention.
>
> **Step 6 — Retention, backup, and undo.** A `retention` cron job that downsamples
> `location_points` older than 30 days and strips `activity_logs` bodies older than 30
> days (keep metadata). Version `profiles.bio` into `bio_versions` before
> `regenerateBio()` overwrites it. Add `deleted_at` soft deletes. Add a weekly full JSON
> export. The product's entire defensibility is accumulated personal history and there is
> currently no backup of it.
>
> **Step 7 — Routing eval harness.** Encode the documented lesson: parse the live system
> prompt out of `api/capture.js` (so it cannot drift), run each test phrase **4×**
> against the real router, and assert the chosen tool. Include the known-flaky
> "Move my dentist appointment to Thursday" → `modify_event`. Gate it behind an env
> var so it never runs in CI without a key.
>
> **Step 8 — Low-data honesty.** Add a "what the system did yesterday" view listing
> every scheduled job, whether it ran, and whether it deliberately chose silence. Add an
> explicit warm-up state ("the observer needs ~14 days of history; you're on day N").
> Enforce the 14-day floor for correlation claims **in code**, not in a prompt. The
> biggest risk to this project is not a bug — it is that correct silence is
> indistinguishable from a broken app.
>
> **Testing standard for every step:** `npm test` must pass. After backend changes,
> exercise `/api/capture` with one create, one query, and one modify. After `web/`
> changes, `cd web && npx vercel --prod --yes` and load `/`, `/data`, `/settings`.
> Never report a step complete without saying what you actually ran.
>
> **Tone:** the user has no formal CS background, wants high-level "what does this
> file do and how does it connect" explanations rather than line-by-line walkthroughs,
> and has a standing instruction: be blunt, hold nothing back, never soften a finding.

---

## 4. What was actually changed in this pass

Tier 0 is done, except the one item that requires looking at a dashboard.

| Item | Status |
|---|---|
| 0.1 Fix the cron `Bearer undefined` bypass | ✅ fixed, regression test added |
| 0.2 Central model registry | ✅ `lib/models.js`, all 20 call sites, enforced by test |
| 0.3 `npm test` that actually runs | ✅ 19 tests, offline, zero new dependencies |
| 0.4 Schema-drift probe | ✅ `lib/schema.js`, surfaced on `/settings` |
| 0.5 Run pending migrations | ✅ **all five were already applied** — but one was inert; fixed (below) |
| 0.6 Verify the Vercel cron limit | ✅ verified (fifth Aug 5 session) — `npx vercel crons ls` plus independent database evidence (fresh `news_items` at 11:36 UTC with no manual trigger, a `briefs` row at 13:00:59, a `daily_metrics` rollup at 13:21) confirms all four crons fire on this account, just ~30-50min behind the exact minute — Hobby's documented "loose timing," not a dropped job. §1.8 below is resolved for this account as of this date. |

Two additional structural fixes, both discovered while making the above possible:

- **`package.json` declared `"type": "commonjs"` while 100% of the source is ESM.**
  This is *why* the project had no tests — nothing in the repo could be run with plain
  `node`. Changed to `"module"` after verifying zero CommonJS constructs anywhere.
- **`lib/supabase.js` built its client at module scope**, so importing any data-layer
  file threw without a full production environment. Now lazy, via a proxy, so call sites
  are unchanged. In production this also converts a cold-start crash into an error that
  names the missing variable.

### §1.3 was not hypothetical — it was already happening

The schema probe found, within a minute of existing, that
`docs/schema-memory-retrieval.sql` was **applied and completely inert**. No memory had
ever been embedded, so `match_memories()` — which filters `where embedding is not null` —
returned zero rows for every query. Zero rows is truthy, so it passed the error guard in
`getRelevantMemories()` and fell through to the blend step, handing every reasoning call
**4 memories instead of 12**, with no error and no log, for an unknown number of days.

Meanwhile the handoff doc recorded this migration as *not run*, and recorded
`app_settings` as *not run* when it had been. Prose was wrong about the database in both
directions simultaneously.

Fixed three ways: `getRelevantMemories()` now treats an empty retrieval as a symptom
rather than an answer; `lib/schema.js` reports "applied but inert" as its own state; and
the backfill was run — 7/7 memories embedded, semantic ranking verified.

**This is the strongest possible argument for Tier 1.2.** The system's most carefully
engineered safety property — graceful degradation — is also the mechanism by which it
lies about itself. Every `catch → fall back` in this codebase is a place a feature can be
dead while the dashboard stays green. Degradation without a health signal is not
resilience; it is a silent failure with good manners.
