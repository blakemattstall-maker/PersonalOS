# PersonalOS — Current State Handoff
**Date:** August 4, 2026
**Purpose:** Bring a new assistant (Claude Code) up to speed on exactly where this project stands. Read alongside `PersonalOS-Architecture-Source-of-Truth.md` (the *why*). This doc covers what's actually built, tested, and true *right now* — it changed enormously in one long session on 2026-08-04, so don't trust anything from before that date without verifying against the live code/deployment.

---

## About the builder

- Blake, 19, Illinois State University (Business Marketing, rising sophomore, grad May 2029). Full profile — education, career goals, VATHOS (his fragrance brand), working style — is saved in `profiles.bio` in Supabase and automatically fed into every synthesis tool via `buildRichContext()`. Don't re-derive this from scratch; read the field.
- No formal coding background. Learned everything through step-by-step guidance in chat. Still wants explanations at a high level ("what does this file do and how does it connect"), not line-by-line code walkthroughs.
- **Standing tone rule, not a suggestion:** blunt, hold nothing back, no topic off-limits, never soften a finding for comfort. Applies to every judgment/synthesis tool (deep thinking, nudges, general_question, and anything built later). See memory `personalos-feedback-tone-and-priorities` for the exact quotes and reasoning.
- **Model selection: standing discretion granted.** Pick whatever model best fits a task's actual reasoning demands without asking first. Only economize when the cost difference is actually meaningful — not reflexively cheap. Current tiering: `gpt-4o-mini` for high-frequency routing/extraction, `gpt-5.6-terra` for moderate reasoning over rich context, `gpt-5.6-sol` for occasional high-stakes reasoning (deep thinking, plan-building).
- Budget-conscious but not paranoid: OpenAI is the one paid line item, auto-refill is **off** (hard ceiling, no runaway-spend risk), and the builder tracks it via OpenAI's own dashboard — declined building in-app cost visibility. Vercel/Supabase/GitHub/Google are all still free; see the architecture doc for the one real constraint (Vercel's 12-function Hobby cap) that could eventually force a $20/mo decision.
- This is a real daily driver, not a toy — reliability, idempotency, and not silently breaking real commitments still matter as much as day one.

---

## What's built and confirmed working

### Core loop, reliability, read path (Phases A–B — stable, unchanged in spirit)
Shortcut → `/api/capture` → OpenAI planner (now **native tool-calling**, not inline JSON-schema-as-prompt-text — see Phase F below) → `router.js` → tool execution → Supabase logging. Failure logging, timezone-from-profile, and idempotent duplicate protection on tasks/events all still hold.

### Phase F — native tool calling, multi-action (done)
`lib/toolDefinitions.js` holds every tool as a structured OpenAI function definition. `api/capture.js` loops over however many tool calls the model returns in one request — "add the meeting and remind me to bring the contract" now genuinely does both in one shot. Adding a new tool going forward is just: a schema entry + a router case + the function — no prompt text to write. ~13 tools now (calendar, tasks, memory, notes, bodyweight, deep thinking, Canvas sync, intentions, projects, general question).

### Read path, fully built
`query_schedule`, `query_tasks`, `query_notes`, `query_projects` — all read live from source (Google or Supabase), format for a reader not a parser, synthesize an answer rather than dumping raw data.

### Background execution (Phase C — done, now 3 daily crons)
Vercel Cron, Hobby plan (once/day per job, ~100 job cap, nowhere near it):
- `morningBrief` (13:00 UTC) — combines schedule + tasks into one saved brief
- `syncCanvas` (12:00 UTC) — pulls ISU assignments in an hour early so they can appear in that day's brief
- `reviewIntentions` (12:30 UTC) — reviews open intentions for nudges *and* checks active projects for missed-deadline cascades (folded into one file to conserve the function count, not two crons)

### Web frontend (done, separate Vercel project)
`https://web-blake-007c.vercel.app` — Next.js, deployed as its **own Vercel project** from `web/` in this same repo, deliberately kept separate from the API backend (`personal-os` project) so the working `/api/*.js` functions are never at risk from frontend changes. Passphrase-gated (`proxy.js` + cookie; Next.js 16 renamed `middleware.js` → `proxy.js`, don't reintroduce the old filename). Backend API itself still has **no auth** — see Known Limitations.

Structure: **Needs You** (pending deep-thoughts + nudges, each resolvable) / **Projects** (active projects with tasks/materials, deletable) / **Today** (the brief) / **History** page (resolved items + past briefs) / **Manage Data** page (browse+delete memories/notes/intentions without touching Supabase).

### Deep thinking (done, several iterations)
`start_deep_thinking` — `gpt-5.6-sol`, returns structured JSON (`verdict`/`reasoning`/`pros`/`cons`/`open_questions`), takes an actual opinionated stance rather than staying neutral, grounded in bio + memories + bodyweight trend via `buildRichContext()`. Runs via `waitUntil` (`@vercel/functions`) so the Shortcut gets an ack in ~3 seconds instead of waiting 20-40s for the full analysis — this was a real fix, not cosmetic (see memory `personalos-interactive-threads` for the exact bug).

### Interactive threads + project building (done, the biggest single feature built this session)
Any deep-thought on the dashboard has a response box (dictate via the iOS keyboard — deliberately **not** browser SpeechRecognition, which is unreliable on iOS Safari and specifically breaks in Home-Screen-app mode; SpeechSynthesis for tap-to-play "read aloud" is used instead since it's reliable but must fire from a direct user gesture). `respondToThread()` asks clarifying questions or revises with a **short diff summary only** — never repeats the whole analysis. Once KPIs + a deadline are clear, it proposes building a plan; on confirmation, `buildPlan()` generates a sequenced workback schedule as real tasks (+ calendar events for time-specific ones) and creates a real `projects` row, using the previously-empty existing `goals`/`projects` tables rather than new parallel ones. Missed deadlines cascade-reschedule only *downstream* tasks/events (by `sequence_order`), guarded against re-triggering the same miss daily (`tasks.cascade_shifted`).

**Real bugs found and fixed during live testing — read `personalos-interactive-threads` memory before touching this code:**
1. `api/deepThoughts/index.js` and `api/projects.js` both need `maxDuration: 60` in `vercel.json` — they do a big model call plus sequential Google API calls and silently die at Vercel's 10s default otherwise.
2. Don't embed-select `goals(...)` through `projects.goal_id` — the column exists but has no actual FK constraint, so PostgREST can't resolve the join.
3. **A client-side timeout on a long-running endpoint does not mean the server-side operation failed** — it may have completed anyway. `buildPlan` now guards against double-building; apply the same caution (check before retrying) to anything else that writes to Google.
4. Full project deletion (`deleteProject()` in `tools/projects.js`) removes the real Google Tasks/Calendar items *first*, then Supabase records, clearing any `deep_thoughts.project_id` reference before the FK would block the delete. Wired to a "Delete project" button on the dashboard — the builder can undo a test/mistake himself without going through Claude.

**Deliberately deferred, not forgotten:** live web search for planning material needs OpenAI's Responses API (a different surface than `chat.completions`, which is all this codebase uses today) — scoped out to avoid an unproven second integration inside an already-large change. Materials are currently AI-authored from context only.

### Canvas assignment sync (done, via a workaround worth understanding)
ISU blocks students from generating personal access tokens (FERPA policy, common across institutions — **do not suggest working around this**, it's a deliberate institutional restriction, not a bug). Uses the Calendar Feed ICS export instead (`CANVAS_ICS_URL` env var, a private-but-not-token-gated URL every Canvas user has under Calendar → Calendar Feed). Daily sync, idempotent via `tasks.canvas_assignment_id`. The ICS feed only exposes title/due-date/URL — no real assignment descriptions/instructions, so "make me a plan for this Canvas assignment" needs the user to paste the actual requirements; the system can't read them on its own.

### Intentions + nudges (done)
`save_intention` captures forward-looking statements **broadly** — even without an explicit "remember this" (deliberate choice, confirmed by the builder over the narrower "explicit mentions only" option). Daily review judges each open intention *independently* whether today is the moment to surface it — default is silence, no bundled digest, no fixed schedule per item. This was an explicit, considered UX requirement: "I don't want one big notification with one large followup — it takes the magic out of it."

### Bodyweight tracking (done)
`log_bodyweight` + 17 real historical entries imported. Trend feeds `buildRichContext()` alongside bio/memories for anything fitness/health/discipline-adjacent.

### Data hygiene (done)
`/data` page — browse and delete memories/notes/intentions directly, no Supabase dashboard needed. Built because the builder explicitly didn't want to have to check Supabase to manage what the AI saved.

---

## Known limitations, by design — do not "fix" unprompted

- **Backend API has no authentication.** Explicitly, repeatedly flagged and deferred — most recently reaffirmed 2026-08-04 ("keep auth flagged, we'll tackle this when needed / soon"). Do not build this unprompted. It's becoming more relevant as more sensitive data (Canvas, full profile, deep-thinking history) flows through, and the builder knows this — he's choosing the timing deliberately.
- **Location/time tracking was explicitly declined**, not deferred-with-intent: "Maybe we skip location for now. It feels very cool, but may just be novelty." Don't propose building this unless asked again.
- **Live web search** (OpenAI's Responses API `web_search` tool) is approved in principle for future research-material generation, but not yet integrated — different API surface than everything else in this codebase.
- **Vercel Hobby's 12-serverless-function-per-deployment cap is real and currently maxed out** (exactly 12 as of 2026-08-04). Any new endpoint must fold into an existing consolidated file (method-based routing, like `api/deepThoughts/index.js` and `api/projects.js` already do) rather than adding a new file. If the number of genuinely distinct resource types keeps growing, this is the constraint most likely to force a real "pay for Vercel Pro" decision — not compute or traffic, which are generous even on Hobby.
- `profiles.timezone` is still `America/Los_Angeles`. The builder returns to Illinois (Central time) around 2026-08-08/09 — this needs a manual update around then or everything will show wrong local times. Watch for this.

---

## What's NOT built yet

- Backend API auth (flagged, deferred on purpose)
- Live web search for planning materials
- Location/time tracking (explicitly skipped)
- Two-way sync — Google-side changes (task checked off in the app, event moved) still don't flow back to Supabase. Lower priority than originally thought, since the read tools (`query_tasks`, `query_schedule`) already read live from Google rather than Supabase's copy.
- Real push notifications (Pushcut was researched, priced at ~$2-4/mo, explicitly declined — native "Show Notification" + a Home Screen web-app icon is the fallback)
- Embedding-based memory retrieval (still blanket top-N by importance)
- An entity graph beyond the direct `goal_id`/`project_id` foreign keys already in use

---

## Immediate next steps, when work resumes

No fixed next feature — the last resolved roadmap conversation left it open pending real-world use. Reasonable candidates, roughly in the order they came up:
1. Test the missed-deadline cascade with a **real** overdue project task (not yet exercised outside initial code-path verification)
2. Live web search integration for planning materials (the one deliberately deferred piece of the interactive-threads feature)
3. Backend auth — only when the builder says go
4. Whatever surfaces from actually using the interactive threads / projects system day to day

---

*Read this alongside `PersonalOS-Architecture-Source-of-Truth.md`. Also check the memory files under `.claude/projects/.../memory/` before assuming anything — they carry forward automatically across sessions and hold a lot of the *why* that doesn't fit in this doc (exact tone-rule quotes, bugs found during testing, the Canvas/Pushcut research findings). Update this doc as state changes.*
