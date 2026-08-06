# PersonalOS — Current State Handoff

**Date:** August 6, 2026 (rewritten same day, sixth session)
**Purpose:** Bring a new assistant up to speed on exactly where this project stands. Read alongside `PersonalOS-Architecture-Source-of-Truth.md` (the *why*). **Do not trust anything dated before this without checking it against live code** — this doc has already been wrong twice in one day earlier this week, in both directions, from exactly that mistake.

---

## About the builder

- Blake, 19, Illinois State University (Business Marketing, rising sophomore). Full profile lives in `profiles.bio` in Supabase and is fed to every reasoning tool via `buildRichContext()`. **Read the field, don't re-derive it.**
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

**Known live issue, not a code bug:** `finance_cache` writes (INSERT/UPDATE/DELETE) are currently failing with `PGRST205` ("table not found in schema cache") while reads against the same table succeed — a Supabase/PostgREST infrastructure asymmetry that has persisted well past normal schema-cache propagation time. `getFinancialData()` degrades safely when this happens (falls back to always-live fetch, exactly the pre-caching behaviour — confirmed, nothing breaks user-facing). **Next step: Blake should try Supabase Dashboard → Project Settings → API → "Reload schema cache," or re-paste `docs/schema-finance-cache.sql`** (idempotent) and watch for any red error text this time. Re-verify the write path directly before assuming it's fixed:
```bash
node --env-file=.env.local -e 'import("./lib/supabase.js").then(async ({default:s}) => { const r = await s.from("finance_cache").insert([{payload:{},warnings:[]}]).select(); console.log(r.error || "OK " + r.data[0].id); if(!r.error) await s.from("finance_cache").delete().eq("id", r.data[0].id); })'
```

### Email and documents (new, Aug 5–6)
`tools/gmail.js` — `draft_email` writes a real Gmail **draft, never sends.** The scope granted (`gmail.compose`) technically permits sending too — Google publishes no drafts-only scope — so the guarantee is enforced in code (the file calls `drafts.create` and nothing else) and by `tests/gmail-never-sends.test.js`, which greps the whole repo for a send method name and fails the suite if one ever appears anywhere.

`tools/googleDocs.js` — `export_to_doc` produces a real formatted Google Doc (headings, bullets, bold via a hand-written markdown→Docs-API converter, verified index-exact against real output) in a `PersonalOS` Drive folder, private on creation. Optionally researches the web first for real, cited content.

**Both are currently blocked on two things only Blake can do**, confirmed live (Aug 6): the Google Cloud project has the **Docs, Drive and Gmail APIs disabled** (403 "has not been used in project... before or it is disabled" — direct enable links are in the error, one per API), and separately, the stored OAuth **refresh token predates these scopes** and needs a fresh consent pass at `/api/auth/google/login`. Both gates are independent — enabling the APIs alone isn't enough; the token also needs the new scopes. Neither can be done from code.

### Deep thinking — audio input, tool toggles, and a real bug fixed
Thread replies can now be **recorded and transcribed** (`web/app/VoiceInput.js`, reusing the pitch recorder's transcription path) instead of relying on iOS's built-in dictation, which has no real punctuation model and stops the moment the user pauses to think. Transcripts append to the reply box rather than replacing it.

**"Build the plan" toggles which capabilities it may use** per plan — research, tasks, events, docs, gmail — shown as checkboxes before the build starts. Defaults match the old always-on behaviour for research/tasks/events; the two that produce outward-facing artefacts (docs, gmail) default off. Turning a tool off changes only where output lands, never the thinking — with tasks off the schedule is still computed and stored on the project, with research off a material keeps the question rather than pretending it has an answer.

**Real bug found and fixed (Aug 6):** `runPlanBuild()` computed the enabled-tools object and then called `executePlanBuild({ deep_thought_id })` — dropping it. `executePlanBuild` had no `tools` parameter and no local definition, but its body read `tools.tasks`/`.events`/`.research`/`.docs`/`.gmail` throughout, so it threw `ReferenceError: tools is not defined` the instant it reached any of them. Because the whole build runs inside a fire-and-forget `waitUntil()`, the crash never reached the client — `buildPlan()` had already returned "Building your plan now," the outer try/catch reset `thread_status` back to `ready_to_build` silently, and from the dashboard this looked exactly like it was reported: loads for a few seconds, stops, no confirmation, nothing built. Reproduced against Blake's actual stuck thread (an internship-exit question), fixed, and re-run live — created a real 12-task project in Google Tasks with 4 materials. `tests/thread-plan-tools.test.js` guards this class of bug offline now (a parameter dropped between these two functions again fails in under a second). The dashboard also now detects *any* future silent build failure (the `building` → `ready_to_build`-without-`active` transition) and shows an honest message rather than letting the button just reappear — honest because a mid-build failure genuinely can leave an orphaned project behind (creation happens before the final status update), so the message says to check Projects rather than falsely claiming nothing was left half-built. **Follow-up flagged, not yet done:** making a retry after a partial failure idempotent instead of risking a duplicate project — spawned as a separate background task.

### Practice — split into Debate and News, plus an explainer mode
Debate used to run off the morning's news digest, which meant topics were whatever the wire feeds carried that day — mostly foreign affairs, which need research before you can argue them at all. That put a reading assignment in front of the feature meant to lower the barrier.

- **Debate** now argues **28 evergreen contested topics** (abortion, billionaires, free speech, AI, religion, drugs...) framed once by the model and stored in `debate_topics`, deduped by slug, sorted least-argued-first. All arguable cold from general knowledge.
- **News** moved to its own `/news` page. Sources widened to US/world/business/tech/science. Ranking is two-phase for cost: one cheap `EXTRACT`-tier call scores all ~45 headlines against the user's actual memories/projects, then only the top few get an expensive `JUDGMENT`-tier framing call. Each story carries as many honest viewpoints as it genuinely has (one for a discovery, none for a natural disaster) instead of a forced two-sided frame.
- **Pitch gained an explainer mode** — `generatePitchTopic()` picks a domain in code (not via the model, which reliably returns Dunning-Kruger/butterfly-effect if just asked for "something interesting") then generates a concept plus a brief forcing application of the idea rather than recitation. Same recorder/transcription, a different grading rubric (understanding vs. persuasion) — verified real runs producing tempered-glass fracture mechanics, Curry's paradox, shared-information bias.

### The observer — widened field of view
`lib/signals.js` used to cover only money, task follow-through, and overdue count — so "you spent too much" worked but "you haven't read a book" or "you haven't seen anyone" were **literally invisible**, because intentions, people and projects were never in its field of view. All three are signals now (stalled intentions, relationships gone quiet, stalled projects), each independently optional so one failure degrades a line, not the whole context. Also fixed: the observer only ever saw *pending* prompts, so a dismissed observation could be re-raised identically the next day forever — it now sees 14 days of its own past digests and is told not to repeat them. Verified live: a dry run produced *"Illinois move is in two days — confirm travel and close Washington loose ends tonight,"* drawn from real location history.

### Proactive mode
- **Web push** — `lib/push.js`, `web/public/sw.js`, manifest, `PushSetup.js`. $0, no vendor.
- **Location** — `tools/location.js`, `api/ingest/[kind].js`. Overland-compatible. Clusters points into places, prompts for labels after 3 visits. **Timezone follows location automatically** once settled (6+ points agreeing across 18h) — verified working correctly, don't "fix" this by hand again if it looks wrong; check the actual last GPS pin first.
- **Daily metrics** — `tools/metrics.js`, one row per day across all domains.
- **The morning brief now actually delivers itself.** It used to be written to the database and just wait — the only thing that ever collected it was a phone-side Shortcut polling `/api/brief/latest`. It's pushed server-side now, on the same cron, gated by the interruption dial like every other notification. **The old polling Shortcut is redundant — confirm delivery, then delete it.**

### Settings, diagnostics, neural TTS
- **`api/[resource].js`** — one dynamic route handling `data`/`history`/`projects`/`nudges`/`deepThoughts`/`settings`/`diag`/`practice`/`people`/`news`. **No public URL has ever changed** from any of this session's work.
- **`lib/settings.js`** — `app_settings` table holds the interruption dial (`silent` / `digest` / `digest_plus_urgent` / `everything`). Every push-sending code path calls `pushAllowed()` first; the underlying record/prompt is still written either way — muting should mean "stop buzzing me," not "stop tracking."
- **`lib/diagnostics.js` / `lib/schema.js`** — one real answer to "is this actually working" and "which migrations are actually live, and are they doing anything." Surfaced at `/settings`. **Check this before believing any doc's claim about state, including this one.**
- **Neural TTS** — `web/app/api/tts/route.js`, `gpt-4o-mini-tts` with a `tts-1` fallback, in the `web/` project (needs its own `OPENAI_API_KEY`).

---

## The Fund — built, then removed (Aug 6)

Blake proposed an accountability mechanic: real money auto-traded based on his behaviour. **Declined the real-money-execution half outright and permanently** — a vibe-coded system placing real securities orders off the back of "did Blake go to the gym" is a bad idea at any dollar amount, and that's a standing constraint on the assistant, not a negotiable design call. Built a paper-portfolio version instead (real prices via Yahoo's chart endpoint, deterministic in-code deposit triggers, a generated eccentric fund manager, morning dispatches riding inside the brief) — fully working, tested, deployed. Blake then decided a paper version isn't worth it: **"only a worthwhile feature if it uses real money."** Removed entirely (`tools/fund.js`, `lib/quotes.js`, the `/fund` page, its cron slot, `docs/schema-fund.sql` — confirmed via live Supabase check that the migration had never been run, so nothing to migrate back). **Do not rebuild this without Blake raising it again, and if he does, the real-money line still holds** — the read-only version (his actual Robinhood positions displayed, never traded) remains fair game for a future financial dashboard.

---

## Hard constraints — read before building

- **All 8 current migrations are applied and active**, confirmed live via `/settings` and `lib/schema.js`: `schema-additions`, `schema-settings`, `schema-memory-retrieval`, `schema-practice`, `schema-people`, `schema-practice-split`, `schema-accountability`, `schema-finance-cache`. The last one's table is visible for reads but currently rejecting writes — see the Money section above. **Don't trust this list without re-running the check** — it changes as Blake pastes SQL, sometimes mid-session.
- **`api/` is at 5/12 serverless functions.** Every new capability this session (Gmail, Docs, debate topics, news, fund [now removed], relationship rework) landed as a new handler inside an existing dynamic route, not a new file. Keep doing that.
- **Supabase DDL is not reachable through PostgREST**, and there is no direct Postgres connection string in this environment either (checked — only the REST URL + service key). New tables require Blake to paste SQL into the Supabase dashboard. Every migration in this session shipped with the app degrading gracefully (missing-table/missing-column checks with a live-tested fallback) so it never blocks a deploy.
- **Backend API auth is live.** `API_SECRET` set in production, checked in `lib/auth.js` via the `x-pos-key` header. `requireAuth` stays dormant-when-unset by design (so the Shortcut and server can switch over independently) but is loud about it in logs and can't be satisfied by a guessable placeholder — same pattern as `CRON_SECRET` in `api/cron/[job].js`, which had a real bug of exactly this kind fixed earlier (compared against the literal string `"Bearer undefined"`, which authenticated anyone when the secret was unset).
- **`web/` is a separate Vercel project and does not auto-deploy.** After changing anything under `web/`: `cd web && npx vercel --prod --yes`. Forgetting this is the single easiest way to report a fix as shipped when only half of it is.
- **`API_SECRET`/`BACKEND_KEY`/`SITE_PASSPHRASE` are marked "sensitive" in Vercel** — `vercel env pull` returns `[Encrypted]` for these specifically, no CLI/API workaround, by design. Test authenticated backend routes through the live web dashboard (holds `BACKEND_KEY` server-side) or `vercel dev` locally with them unset.
- **`sw.js`, `manifest.json`, `icon.svg` must stay excluded from `proxy.js`'s matcher** — fetched outside the page session.
- **Page-swap latency (~700ms-1.5s per navigation) is real and diagnosed, not fixed.** Measured directly: the underlying Supabase queries are fast (<150ms). The cost is the two-hop architecture itself — the `web` project's SSR invocation, then a full HTTP round trip to the completely separate `personal-os` project, each paying its own routing/invocation overhead regardless of query size. Fixed the one clear multi-hop case (home page's N+1 turns fetch, now one query via a PostgREST embedded select). The remaining floor needs an actual choice from Blake, not a unilateral pick: merge the two Vercel projects into one (eliminates the hop, reverses a documented past decision to isolate function budgets) vs. add scoped response caching (risk of a stale dashboard showing wrong task/nudge state). **Ask, don't assume, if this comes up again.**

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
9. **PostgREST schema-cache propagation after a fresh migration can be asymmetric between reads and writes**, and can persist far longer than the "few seconds" normally expected — confirmed via raw REST calls (not just supabase-js) on `finance_cache`. If a brand-new table reads fine but every write returns `PGRST205`, this is very likely it — check Supabase's "Reload schema cache" button before assuming a code bug.

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
4. ~~Gmail draft capability~~ — **built**, blocked on two Google-side gates only Blake can clear (see Email and documents, above).

**What's actually open now:**
- Clear the two Google gates (enable Docs/Drive/Gmail APIs in Cloud Console; re-authorise at `/api/auth/google/login`) so email/doc features go from "built" to "usable."
- Resolve the `finance_cache` write-path issue (see Money, above).
- Decide the page-swap-latency question (merge projects vs. scoped caching) — or explicitly decide to live with it.
- Correlation engine — `daily_metrics` needs 4–8 weeks of paired history; the observer is deliberately refusing to claim trends below 14 days and that refusal is correct, not a bug. **Do not ship trend claims before there's real history to support them.**
- The idempotent-retry follow-up on plan building (spawned as a separate background task, not yet landed as of this writing).

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

This is still a system built faster than it's been lived in, but meaningfully less true than a few days ago — real relationships, real debate sessions, real news personalization data exist now. **The single highest-value thing for this project remains Blake using it daily**, and the seeding questionnaire (published as an artifact, referenced in memory) exists specifically to close that gap faster than organic use alone would.
