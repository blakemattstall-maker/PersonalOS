# PersonalOS — Current State Handoff

**Date:** August 6, 2026 (rewritten same day, sixth session)
**Purpose:** Bring a new assistant up to speed on exactly where this project stands. Read alongside `PersonalOS-Architecture-Source-of-Truth.md` (the *why*). **Do not trust anything dated before this without checking it against live code** — this doc has already been wrong twice in one day earlier this week, in both directions, from exactly that mistake.

---

## About the builder

- The single user of this system. Full profile lives in `profiles.bio` in Supabase and is fed to every reasoning tool via `buildRichContext()`. **Read the field, don't re-derive it.**
- No formal coding background. Wants high-level explanations ("what does this file do and how does it connect"), not line-by-line walkthroughs.
- **Standing tone rule:** blunt, hold nothing back, no topic off-limits, never soften a finding for comfort. Applies to every judgment/synthesis tool.
- **Model selection: standing discretion granted.** Pick the best fit without asking; economize only when the cost delta is real.
- **Cost target: under $10/month all-in.** Currently tracking ~$7–8.
- **Working style he's asked for explicitly:** be independent, ship related features in batches, test thoroughly against live data (not just code review), report back in one go. Don't ask permission for things clearly within an agreed direction — but when a decision reverses a past deliberate design choice (e.g. merging the two Vercel projects) or crosses a hard line (executing real financial trades), surface the choice rather than picking unilaterally.

---

## What's built and working

### The spine
Shortcut → `/api/capture` → `gpt-5.4-mini` router (native tool calling) → `lib/router.js` → tool → Supabase logging. **22 tools.** `/api/capture` now accepts **either** `text` or `audio_base64` + `mime_type` — audio is transcribed server-side before routing, so the whole pipeline downstream is identical either way.

### Reading
`query_schedule`, `query_tasks`, `query_notes`, `query_projects`, `query_finances`, `query_people` — all read live from source, format for a reader, synthesize. **Overdue/late classification happens in code, never in the model.**

### Writing and changing
Create tasks/events. **`modify_task` / `modify_event`** complete, reschedule, delete — resolved from natural language ("the dentist thing"), with a real ambiguity path. Keyed off **Google IDs, never Supabase IDs** (most items exist only in Google). Events now take an optional **colour** (defaults to Tomato/red so anything PersonalOS creates is identifiable at a glance) and an optional **recurrence** word (`daily`/`weekdays`/`weekly`/`biweekly`/`monthly`/`yearly` — the model picks a name, `lib/recurrence.js` owns the actual RRULE syntax, never hand-written by the model).

### Memory, notes, intentions — now deduplicated
`lib/dedupe.js` is a shared "already know that?" check every capture path (`saveMemory`, `saveNote`, `saveIntention`) runs before writing. A cheap normalised-string compare catches the common case (the same Shortcut run twice) for free; a shortlisted, temperature-0 classifier call handles paraphrases and decides `new` / `duplicate` / `update` / `conflict`. An update **rewrites in place and says what changed** — silently overwriting something the user said is how a system starts quietly disagreeing with reality. Built after live data showed the real cost of not having this: two notes with the same door code, four memories all meaning "be blunt with me," a stored goal weight of 185 sitting next to an intention of 190. `scripts/dedupe-existing.mjs` swept the backlog once (dry-run first).

`respondToThread` still extracts durable facts and forward-looking wants from conversation and writes them to memories/intentions — free, rides inside the existing reply call — and now goes through the same dedup layer.

### Relationships — rebuilt
Important dates (birthdays, anniversaries) are **recurring Google Tasks now, not calendar events.** They were events originally, which was wrong twice: a calendar is for things that occupy time, and a one-off event meant the reminder existed for exactly one year and then silently never came back. Google's Tasks API has **no recurrence field at all** (recurring tasks exist in Google's UI but aren't exposed via v1), so `materialiseUpcomingDateReminders()` in `tools/people.js` runs daily and creates each year's task as the date comes into range — idempotent via a **unique index on `tasks.recurrence_key`**, not a check-then-insert.

Check-ins are **staggered on write** — `computeNextCheckIn()` nudges a new date forward (never earlier) until it lands on a day nobody else is already due, so saving five people with the same cadence doesn't schedule all five for one morning. Verified live: three people with an identical 2-day cadence landed on three different days. Check-ins now **push** to the phone (used to be dashboard-only), gated by the interruption dial like everything else. `/people` shows next-nudge and last-contact in subtle text.

### Money — cached, not live-per-request
`tools/finances.js` (query logic, arithmetic always in code) + `lib/simplefin.js` (the client). **As of Aug 6, SimpleFIN is cached** — one row in `finance_cache`, refreshed at most every 12 hours, always fetching a wide 100-day window so any requested window (7/30/90 days) is a slice of the same cached copy. This mattered more than it sounds: `financeSignal()` in `lib/signals.js` reads the same data inside `buildRichContext()`, which nearly every reasoning call pulls in — a general question, a deep-thinking turn, the daily observer, ranking the news feed. Every one of those used to be a live bank API call nobody asked for. Public signature (`getFinancialData({ days })`) is unchanged, so `tools/finances.js` and `tools/metrics.js` needed zero edits.

**Resolved (Aug 6).** Writes were failing with `PGRST205` ("table not found in schema cache") even though the table read fine and had been created with a "success" message in the SQL editor. Root cause, found by checking PostgREST's actual exposed schema directly (`GET /rest/v1/` returns an OpenAPI spec listing every relation it serves — the authoritative source, unlike ad-hoc `.select()`/`.insert()` probes which can give misleading intermittent results) rather than continuing to guess: `finance_cache` genuinely wasn't in that list at all, while other tables from the same timeframe were. Almost certainly caused by `docs/schema-finance-cache.sql`'s original `create unique index ... on finance_cache ((true))` — an unusual constant-expression index — failing and rolling back the `create table` with it, since Supabase's SQL editor runs a pasted script as one transaction. **That index was never functionally required** — `writeCache()` in `lib/simplefin.js` already enforces singleton-ness itself (read-then-insert-or-update, not `ON CONFLICT`) — so it was removed from the migration entirely rather than debugged further. the user ran `drop table if exists finance_cache;` then the simplified migration; both reported success, and this time the table actually showed up in the exposed schema. Verified fully working: a cold call takes ~2.1s (live fetch), a second call with a *different* day-window than the first hits the cache in ~50-70ms with a correctly sliced transaction count, and the cache row itself holds the full wide 100-day window.

**Lesson for next time this kind of thing happens:** don't trust `.select()`/`.insert()` probes when diagnosing a "table not found in schema cache" error — they can report success/failure inconsistently depending on which state you're actually observing. Check `GET {SUPABASE_URL}/rest/v1/` and grep the returned `paths` for the table name — that's PostgREST's own live answer to "what do I actually think exists," and it's what actually resolved this instead of another round of guessing.

### Email and documents (new, Aug 5–6)
`tools/gmail.js` — `draft_email` writes a real Gmail **draft, never sends.** The scope granted (`gmail.compose`) technically permits sending too — Google publishes no drafts-only scope — so the guarantee is enforced in code (the file calls `drafts.create` and nothing else) and by `tests/gmail-never-sends.test.js`, which greps the whole repo for a send method name and fails the suite if one ever appears anywhere.

`tools/googleDocs.js` — `export_to_doc` produces a real formatted Google Doc (headings, bullets, bold via a hand-written markdown→Docs-API converter, verified index-exact against real output) in a `PersonalOS` Drive folder, private on creation. Optionally researches the web first for real, cited content.

**Both fully working as of Aug 6.** Were blocked on two things: the Google Cloud project had the Docs/Drive/Gmail APIs disabled (403, direct enable links in the error), and — expected to also need — a fresh OAuth consent pass at `/api/auth/google/login` since the stored refresh token predates these scopes. the user enabled the three APIs in Cloud Console. **Surprising result, worth remembering:** the *existing* refresh token (issued Aug 2, before these scopes existed in code) worked immediately for all three once the APIs were enabled — no re-auth was needed. Verified by actually running `exportToDoc()` and `draftEmail()` end to end against the real account (not just pinging the APIs): a real Doc was created and filed into the `PersonalOS` Drive folder, a real Gmail draft was created with `sent: false` confirmed, both cleaned up after. **Don't assume a re-auth is needed just because a scope was added to `SCOPES` in code** — check whether the existing token already covers it before sending the user through the consent screen again. The `granted`/`missing` fields the OAuth callback reports are still the fast way to check if this ever does become necessary.

### Deep thinking — audio input, tool toggles, and a real bug fixed
Thread replies can now be **recorded and transcribed** (`web/app/VoiceInput.js`, reusing the pitch recorder's transcription path) instead of relying on iOS's built-in dictation, which has no real punctuation model and stops the moment the user pauses to think. Transcripts append to the reply box rather than replacing it.

**"Build the plan" toggles which capabilities it may use** per plan — research, tasks, events, docs, gmail — shown as checkboxes before the build starts. Defaults match the old always-on behaviour for research/tasks/events; the two that produce outward-facing artefacts (docs, gmail) default off. Turning a tool off changes only where output lands, never the thinking — with tasks off the schedule is still computed and stored on the project, with research off a material keeps the question rather than pretending it has an answer.

**Real bug found and fixed (Aug 6):** `runPlanBuild()` computed the enabled-tools object and then called `executePlanBuild({ deep_thought_id })` — dropping it. `executePlanBuild` had no `tools` parameter and no local definition, but its body read `tools.tasks`/`.events`/`.research`/`.docs`/`.gmail` throughout, so it threw `ReferenceError: tools is not defined` the instant it reached any of them. Because the whole build runs inside a fire-and-forget `waitUntil()`, the crash never reached the client — `buildPlan()` had already returned "Building your plan now," the outer try/catch reset `thread_status` back to `ready_to_build` silently, and from the dashboard this looked exactly like it was reported: loads for a few seconds, stops, no confirmation, nothing built. Reproduced against the user's actual stuck thread (an internship-exit question), fixed, and re-run live — created a real 12-task project in Google Tasks with 4 materials. `tests/thread-plan-tools.test.js` guards this class of bug offline now (a parameter dropped between these two functions again fails in under a second). The dashboard also detects *any* future silent build failure (the `building` → `ready_to_build`-without-`active` transition) and shows an honest message rather than letting the button just reappear.

**Follow-up done (Aug 6, via a background task, reviewed and re-verified live before merging):** retries are now genuinely idempotent. `executePlanBuild()` attaches `project_id` to the deep_thought the moment `createProject()` succeeds — well before the final `thread_status: "active"` update — so a build that fails partway through (tasks, research, docs or email throwing after the project already exists) leaves `project_id` set even though `thread_status` reverts. `buildPlan()`'s duplicate check now keys on `project_id` alone rather than `thread_status === "active" && project_id`, so a retry detects the orphan and refuses to duplicate it, returning a message that distinguishes "already built" from "a previous attempt already created a project for this before failing." Verified directly against two simulated database states (the orphan case and the normal-completion case) before committing. The dashboard's warning copy was updated to match — it no longer claims a retry might create a duplicate, since it can't; `buildPlanAction`'s response is now captured and shown directly when it's a duplicate, rather than the generic banner covering both cases.

### Practice — split into Debate and News, plus an explainer mode
Debate used to run off the morning's news digest, which meant topics were whatever the wire feeds carried that day — mostly foreign affairs, which need research before you can argue them at all. That put a reading assignment in front of the feature meant to lower the barrier.

- **Debate** now argues **28 evergreen contested topics** (abortion, billionaires, free speech, AI, religion, drugs...) framed once by the model and stored in `debate_topics`, deduped by slug, sorted least-argued-first. All arguable cold from general knowledge.
- **News** moved to its own `/news` page. Sources widened to US/world/business/tech/science. Ranking is two-phase for cost: one cheap `EXTRACT`-tier call scores all ~45 headlines against the user's actual memories/projects, then only the top few get an expensive `JUDGMENT`-tier framing call. Each story carries as many honest viewpoints as it genuinely has (one for a discovery, none for a natural disaster) instead of a forced two-sided frame.
- **Pitch gained an explainer mode** — `generatePitchTopic()` picks a domain in code (not via the model, which reliably returns Dunning-Kruger/butterfly-effect if just asked for "something interesting") then generates a concept plus a brief forcing application of the idea rather than recitation. Same recorder/transcription, a different grading rubric (understanding vs. persuasion) — verified real runs producing tempered-glass fracture mechanics, Curry's paradox, shared-information bias.

### The observer — widened field of view
`lib/signals.js` used to cover only money, task follow-through, and overdue count — so "you spent too much" worked but "you haven't read a book" or "you haven't seen anyone" were **literally invisible**, because intentions, people and projects were never in its field of view. All three are signals now (stalled intentions, relationships gone quiet, stalled projects), each independently optional so one failure degrades a line, not the whole context. Also fixed: the observer only ever saw *pending* prompts, so a dismissed observation could be re-raised identically the next day forever — it now sees 14 days of its own past digests and is told not to repeat them. Verified live: a dry run produced *"the move is in two days, confirm travel and close the remaining loose ends tonight,"* drawn from real location history.

### Proactive mode
- **Web push** — `lib/push.js`, `web/public/sw.js`, manifest, `PushSetup.js`. $0, no vendor.
- **Location** — `tools/location.js`, `api/ingest/[kind].js`. Overland-compatible. Clusters points into places, prompts for labels after 3 visits. **Timezone follows location automatically** once settled (6+ points agreeing across 18h) — verified working correctly, don't "fix" this by hand again if it looks wrong; check the actual last GPS pin first.
- **Daily metrics** — `tools/metrics.js`, one row per day across all domains.
- **The morning brief now actually delivers itself.** It used to be written to the database and just wait — the only thing that ever collected it was a phone-side Shortcut polling `/api/brief/latest`. It's pushed server-side now, on the same cron, gated by the interruption dial like every other notification. **The old polling Shortcut is redundant — confirm delivery, then delete it.**

### Settings, diagnostics, neural TTS
- **`web/app/api/[resource]/`** — one dynamic route handling `data`/`history`/`projects`/`nudges`/`deepThoughts`/`settings`/`diag`/`practice`/`people`/`news`. **No public URL has ever changed** from any of this session's work.
- **`lib/settings.js`** — `app_settings` table holds the interruption dial (`silent` / `digest` / `digest_plus_urgent` / `everything`). Every push-sending code path calls `pushAllowed()` first; the underlying record/prompt is still written either way — muting should mean "stop buzzing me," not "stop tracking."
- **`lib/diagnostics.js` / `lib/schema.js`** — one real answer to "is this actually working" and "which migrations are actually live, and are they doing anything." Surfaced at `/settings`. **Check this before believing any doc's claim about state, including this one.**
- **Neural TTS** — `web/app/api/tts/route.js`, `gpt-4o-mini-tts` with a `tts-1` fallback, in the `web/` project (needs its own `OPENAI_API_KEY`).

### The dashboard was redesigned (Aug 6, branch `ui-redesign`)

the user supplied a reference screenshot (a habit-tracker with soft widget cards) and a five-colour palette, and asked for usability and clutter fixes. **Read `web/app/globals.css` and `web/app/ui.js` before restyling anything** — both open with the reasoning, and the rules below are load-bearing rather than decorative.

- **The ember rule.** `--ember` (`#e07038`) appears in exactly one circumstance app-wide: something is waiting on the user. Not links, not headings, not focus rings, not "primary" buttons that merely save a form. When the queue is clear there is no orange on screen at all. This is what fixes the old problem where every section carried identical weight. If you need emphasis for something that isn't awaiting him, use `--moss` (settled/running/done) or `--ink`. **Don't spend ember on a new feature because it looks good.**
- **Palette** is the user's, unchanged: `#37424a` ink, `#4a6b62` moss, `#b9c0bf` line, `#e07038` ember, `#efeee9` paper. `--ink-soft` is derived and was deliberately darkened to `#5e6a70` for AA contrast on paper. **Known and accepted tradeoff:** `--line` at the user's `#b9c0bf` is ~1.8:1 on card, under the 3:1 WCAG wants for control boundaries. His palette choice won; buttons carry readable labels regardless.
- **Type**: Bricolage Grotesque (display, via `.pos-display`), Inter (body), DM Mono (readings — counts, dates, times, via `.pos-data`). Loaded through `next/font/google` in `layout.js`, self-hosted at build.
- **Navigation is a persistent bottom tab bar** (`TabBar.js`): Today / News / Practice / People / Settings. The old six-link header existed only on home while every other page offered `← Back`, so News→Practice meant a round trip through home at 700ms–1.5s a hop. History and Manage data are reached contextually (from the brief card, and from the top of Settings) rather than getting tabs.
- **Home is reordered and state-dependent.** The headline is the triage count ("Four things need you." / "You're clear."), which replaced the reference's greeting-plus-week-strip — the user disliked the date component, and nothing in this app is browsable per-day, so a week strip would have been decoration in the most valuable space. When the queue is non-empty it renders above the brief; when empty it renders nothing and the brief becomes the first card, with no special-casing. The brief used to be dead last.
- **Thoughts, nudges and prompts are now visually distinct** — separate widgets with their own icon tiles, instead of one undifferentiated list separated by hairlines and distinguished only by a small grey eyebrow word.
- **Debug copy naming `.sql` files was removed from user-facing empty states.** `/practice` used to tell the user to paste `docs/schema-practice-split.sql` into Supabase. Those strings still exist in `tools/` where they belong (server responses, Diagnostics).
- **Fixture mode** — `POS_FIXTURES=1` + `web/app/fixtures.js`, wired to the `web-preview` launch config. A local dev server can't reach the backend (`API_SECRET` is live, `BACKEND_KEY` isn't in `.env.local`), so without this every page renders empty and design work is blind. Paints an orange "nothing here is real" bar. Set nowhere but that one launch entry.

---

## The Fund — built, then removed (Aug 6)

the user proposed an accountability mechanic: real money auto-traded based on his behaviour. **Declined the real-money-execution half outright and permanently** — an automated system placing real securities orders off the back of "did the user go to the gym" is a bad idea at any dollar amount, and that's a standing constraint on the assistant, not a negotiable design call. Built a paper-portfolio version instead (real prices via Yahoo's chart endpoint, deterministic in-code deposit triggers, a generated eccentric fund manager, morning dispatches riding inside the brief) — fully working, tested, deployed. the user then decided a paper version isn't worth it: **"only a worthwhile feature if it uses real money."** Removed entirely (`tools/fund.js`, `lib/quotes.js`, the `/fund` page, its cron slot, `docs/schema-fund.sql` — confirmed via live Supabase check that the migration had never been run, so nothing to migrate back). **Do not rebuild this without the user raising it again, and if he does, the real-money line still holds** — the read-only version (his actual Robinhood positions displayed, never traded) remains fair game for a future financial dashboard.

---

## The fold — one deployment instead of two (Aug 7, branch `fold-into-nextjs`)

The page-swap latency question in the constraints below is answered. The
dashboard and the API were separate Vercel projects and every page load paid a
full HTTP round trip between them — six on the home page alone. Measured against
production while writing this: six calls that did *no work at all* (they 401'd)
still cost 816ms purely in routing.

Everything now lives in the `web` project. `lib/` and `tools/` moved under it,
and the five API handlers became Next.js route handlers.

**The handlers themselves were not rewritten.** They are byte-identical, moved
to `handler.js` beside a thin `route.js`, and adapted by `web/app/api/_node.js`,
which presents the `(req, res)` they already expect. Rewriting ~1,450 lines of
debugged handler into Request/Response style would have put the risk in every
branch of every file; this puts all of it in one small adapter that every route
shares and `tests/api-routes.test.js` covers directly.

`web/app/backend.js` no longer speaks HTTP — it invokes the same handler
in-process. **All eleven dashboard callers were deliberately left untouched**,
because the point of that shape is that the hop disappears without any page
having to know it existed.

### What this migration nearly broke, and what caught it

- **The passphrase gate would have eaten every capture.** `proxy.js` redirects
  anything unmatched to `/login`. With the API inside the app, the Shortcut,
  Overland, Vercel Cron and Google's OAuth redirect — none of which hold a
  session cookie — would each have received an HTML login page. A capture would
  have looked like it succeeded and silently done nothing. `api` is excluded
  from the matcher now, and a test asserts both directions: `/api/*` bypasses,
  every real page still doesn't.
- **Three pages silently became static.** `backendGet` used
  `fetch(…, { cache: "no-store" })`, which opted routes out of static generation
  as a side effect nobody had written down. A direct function call gives Next
  nothing to notice, so `/`, `/data` and `/history` were prerendered at build
  time and would have served build-time data until the next deploy. Caught by
  reading the build output — `○ (Static)` where `ƒ (Dynamic)` belonged. All
  three now declare `force-dynamic` explicitly.
- **In-process calls would have 401'd in production.** The handler still runs
  `requireAuth`, correctly — so `backend.js` presents the same credential a
  remote caller would. Without it, every page would have gone empty the moment
  `API_SECRET` was read, and it would have looked like a data problem.
- **The resource never reached the handler.** Over HTTP, Next merges the
  `[resource]` path segment into the params; in-process nothing does that merge,
  so every call returned `Unknown resource: undefined` while the HTTP routes
  worked perfectly. Found by `scripts/verify-fold.mjs`, not by any unit test —
  it is exactly the gap between "the route works" and "the way the app actually
  calls it works".

### Before merging

1. `bash scripts/migrate-env-to-web.sh` — copies the backend environment onto
   the web project. Until this runs a deployed build has no credentials.
   `API_SECRET` is the one it cannot copy (Vercel will not reveal a sensitive
   value); the script explains the two ways to handle it.
2. `cd web && npx vercel --prod --yes` — the dashboard has never auto-deployed
   and still doesn't.
3. Crons moved to `web/vercel.json` and are gone from the root. They only fire
   on production deployments, so nothing runs from a branch preview.

Rollback is `git revert` plus a redeploy. The `personal-os` project keeps its
own environment untouched throughout, so it can serve the API again immediately.

---

## Hard constraints — read before building

- **All 8 current migrations are applied and active**, confirmed live via `/settings` and `lib/schema.js`: `schema-additions`, `schema-settings`, `schema-memory-retrieval`, `schema-practice`, `schema-people`, `schema-practice-split`, `schema-accountability`, `schema-finance-cache`. **Don't trust this list without re-running the check** — it changes as the user pastes SQL, sometimes mid-session.
- **`api/` is at 5/12 serverless functions.** Every new capability this session (Gmail, Docs, debate topics, news, fund [now removed], relationship rework) landed as a new handler inside an existing dynamic route, not a new file. Keep doing that.
- **Supabase DDL is not reachable through PostgREST**, and there is no direct Postgres connection string in this environment either (checked — only the REST URL + service key). New tables require the user to paste SQL into the Supabase dashboard. Every migration in this session shipped with the app degrading gracefully (missing-table/missing-column checks with a live-tested fallback) so it never blocks a deploy.
- **Backend API auth is live.** `API_SECRET` set in production, checked in `lib/auth.js` via the `x-pos-key` header. `requireAuth` stays dormant-when-unset by design (so the Shortcut and server can switch over independently) but is loud about it in logs and can't be satisfied by a guessable placeholder — same pattern as `CRON_SECRET` in `api/cron/[job].js`, which had a real bug of exactly this kind fixed earlier (compared against the literal string `"Bearer undefined"`, which authenticated anyone when the secret was unset).
- **`web/` is a separate Vercel project and does not auto-deploy.** After changing anything under `web/`: `cd web && npx vercel --prod --yes`. Forgetting this is the single easiest way to report a fix as shipped when only half of it is.
- **`API_SECRET`/`BACKEND_KEY`/`SITE_PASSPHRASE` are marked "sensitive" in Vercel** — `vercel env pull` returns `[Encrypted]` for these specifically, no CLI/API workaround, by design. Test authenticated backend routes through the live web dashboard (holds `BACKEND_KEY` server-side) or `vercel dev` locally with them unset.
- **`sw.js`, `manifest.json`, `icon.svg` must stay excluded from `proxy.js`'s matcher** — fetched outside the page session.
- **Page-swap latency (~700ms-1.5s per navigation) is real and diagnosed, not fixed.** Measured directly: the underlying Supabase queries are fast (<150ms). The cost is the two-hop architecture itself — the `web` project's SSR invocation, then a full HTTP round trip to the completely separate `personal-os` project, each paying its own routing/invocation overhead regardless of query size. Fixed the one clear multi-hop case (home page's N+1 turns fetch, now one query via a PostgREST embedded select). The remaining floor needs an actual choice from the user, not a unilateral pick: merge the two Vercel projects into one (eliminates the hop, reverses a documented past decision to isolate function budgets) vs. add scoped response caching (risk of a stale dashboard showing wrong task/nudge state). **Ask, don't assume, if this comes up again.**
  A second, separate cost was hiding inside that same number: `api/[resource].js` — the single function behind every dashboard read — statically imported `tools/thread.js` (fixed in `cf8124d`, lazy dynamic import) and, until this session, `tools/people.js`/`tools/projects.js` pulled in `googleTasks.js`/`googleCalendar.js`, both of which did a top-level `import { google } from "googleapis"`. That SDK alone measured ~500ms to load cold. Every dashboard request — even "get pending nudges" — paid to load it, whether or not the request touched Google. Fixed by moving the `googleapis` import into `lib/google.js`, loaded lazily on first `getGoogleClient()` call and cached per warm container; `getGoogleClient()` now returns `{ auth, google }` instead of just `auth` so callers don't need their own static import. Measured locally: module load time for `api/[resource].js` went from 304ms to 53ms. This does not replace the two-hop architecture question above — it removes a second, independent tax that was compounding it.

---

## Traps that have already bitten

1. **Google Tasks stores a DATE, returned as UTC midnight.** Reading it as a timestamp west of UTC rolls every due date back a day. Use `taskDueDate()`, compare due-vs-today as `yyyy-MM-dd` **strings**, never instants.
2. **`getEvents` defaults to `maxResults: 50`** and expands recurring events per occurrence — a wide window silently truncates and reports "not found".
3. **Never let a model do arithmetic and then narrate it.** Compute, then hand the figure over as fact.
4. **A client timeout does not mean the server failed.** A timed-out `buildPlan` had succeeded; the retry built a second project with real Google tasks. (This exact failure shape — a background job whose result the client never sees — is also why the Aug 6 `executePlanBuild` bug went undetected until a user hit it: nothing watches a `waitUntil()` job's outcome by default. Now something does, on the dashboard side.)
5. **Single-sample evals hide flakiness.** Run routing evals 4× per phrase; parse the real prompt out of `api/capture.js` so it can't drift.
6. **PostgREST rejects an insert containing ANY unknown column, regardless of the value being null.** This is why every migration this session used the same conditional-column-then-retry-without-it pattern (`tools/database.js`, `tools/people.js`, `tools/pitch.js`) rather than always sending the new column.
7. **A dropped function parameter inside a fire-and-forget background job fails completely silently.** No client ever awaits it, so a `ReferenceError` only ever reaches server logs. The `executePlanBuild` bug above is the canonical instance — worth a repo-wide sweep if another `waitUntil()`-wrapped function gets added without a matching offline contract test.
8. **A file's mime type substring check is not the same as its actual format.** `tools/pitch.js` checked whether a mime type contained `"mp4"` to decide the upload filename; iOS's Record Audio action reports `audio/m4a`, which does not contain that substring, so every real Shortcut voice capture would have been uploaded as `.webm` and rejected as corrupt. Fixed with an explicit, ordered mapping (`extensionFor()`) rather than substring matching, before it shipped to real use.
9. **A `PGRST205` "table not found in schema cache" that survives `NOTIFY pgrst, 'reload schema';` means the table probably never actually got created — check PostgREST's real exposed schema before assuming it's a propagation-timing issue.** This is what happened to `finance_cache`: an unusual `create unique index ... on t ((true))` statement in the same pasted script very likely failed and rolled back the `create table` with it (Supabase's SQL editor runs a pasted script as one transaction), and ad-hoc `.select()`/`.insert()` probes gave misleading, inconsistent results while chasing it as a caching issue. The actual diagnostic: `curl "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_KEY"` returns an OpenAPI spec — grep its `paths` for the table name. If it's not there, the table doesn't exist, full stop; no amount of NOTIFY or waiting fixes that. Fix the table (usually: drop anything partial, simplify the migration, recreate), don't keep re-triggering a cache reload for a cache that has nothing to load.

---

## Cost model (target: under $10/mo)

| Item | Monthly |
|---|---|
| Vercel Hobby, Supabase Free, Google APIs, web push, Overland | $0 |
| SimpleFIN | $1.50 |
| OpenAI (routing, judgment calls, embeddings, TTS, audio transcription) | ~$4–6 |
| **Total** | **≈ $7–8** |

Audio capture adds a small, real line item (~$0.003/capture all-in, ≈$0.90/mo at 10 captures a day) — not a reason to avoid it; it was traded against dictation's near-zero punctuation quality on purpose. **The budget risk is still not a subscription — it's OpenAI context bloat.** Retrieval-based memory remains the budget control on that, not an optimisation.

---

## Model tiering

- `gpt-5.4-mini` — `ROUTER` and `EXTRACT`: routing, all query tools, news headline ranking.
- `gpt-5.6-terra` — `JUDGMENT`: threads, plan building, nudges, general questions, finances, observer, bio regeneration, debate/pitch grading, news framing, dedup classification.
- `gpt-5.6-sol` — `DEEP`: the opening deep-thinking analysis only.
- `gpt-5.6-luna` — **do not use for routing.** Cannot use function tools in `chat.completions` except with `reasoning_effort: "none"`, and ~2.5× slower. Named in `lib/models.js`'s `UNSUITABLE_FOR_ROUTING` so the finding survives outside this doc.

---

## Agreed direction — what was open, and where it stands now

Everything explicitly flagged as "not yet ranked" in the previous version of this doc has shipped:

1. ~~News/debate + skill challenges bundle~~ — **done**, then further split into Debate (evergreen) vs. News (personalized reader) once real use showed the combined version was worse at both jobs.
2. ~~Relationship management~~ — **done**, then rebuilt once real use surfaced two bugs (calendar events instead of recurring tasks, no check-in staggering).
3. ~~Live web search~~ — **done**, backing research queries, plan materials, and Docs export.
4. ~~Gmail draft capability~~ — **done and fully working**, verified end to end (see Email and documents, above).
5. ~~Idempotent plan-build retries~~ — **done**, landed via a background task, reviewed and re-verified live before merging (see Deep thinking, above).
6. ~~`finance_cache` write path~~ — **done**, root cause found and fixed (see Money, above) — not the schema-cache-propagation issue it first looked like.

**What's actually open now:**
- Decide the page-swap-latency question (merge projects vs. scoped caching) — or explicitly decide to live with it.
- Correlation engine — `daily_metrics` needs 4–8 weeks of paired history; the observer is deliberately refusing to claim trends below 14 days and that refusal is correct, not a bug. **Do not ship trend claims before there's real history to support them.**

### Product decisions already made — don't re-litigate
- **Interruption budget: one digest a day + genuinely urgent only.** A muted app kills every other feature.
- **Autonomy: propose, never write without a yes** for anything consequential — extended explicitly to real financial trades (see The Fund, above): this is not just a UX preference, it's a hard line the assistant holds regardless of what's asked.
- **Location: continuous**, via Overland.
- **Push: Web Push, not Pushcut.**
- **Apple Health: dropped.**
- **The Fund (real-money version): declined, permanently.** A paper/read-only version is still fair game if raised again.

---

## Honest state of the data (Aug 6)

16 memories, 1 note, 7 intentions, 8 people, 1 project, 4 deep thoughts, 14 evergreen debate topics, 17 news items, 3 practice sessions. Location has real history (see location-based timezone note above). Retrieval memory readiness confirmed live: all embedded, semantic ranking verified working.

This is still a system built faster than it's been lived in, but meaningfully less true than a few days ago — real relationships, real debate sessions, real news personalization data exist now. **The single highest-value thing for this project remains the user using it daily**, and the seeding questionnaire (published as an artifact, referenced in memory) exists specifically to close that gap faster than organic use alone would.
