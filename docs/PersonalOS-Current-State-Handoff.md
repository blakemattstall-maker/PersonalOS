# PersonalOS — Current State Handoff
**Date:** August 3, 2026
**Purpose:** Bring a new assistant (Claude Code) up to speed on exactly where this project stands. The original handoff doc and the architecture doc (`PersonalOS-Architecture-Source-of-Truth.md`) cover vision and long-term design — this covers what's actually built, tested, and true *right now*.

---

## About the builder

- No formal coding background, not a CS major. This is a first major software project.
- Zero coding experience going in — has learned everything through step-by-step guidance in chat.
- Prefers: one change at a time, explained clearly, tested and confirmed before moving on. Wants to understand *why*, not just get working code.
- This is intended to be a **daily driver** the builder will actually depend on — not just a learning exercise. That raises the bar on reliability, failure handling, and not silently breaking real commitments (a duplicate calendar event has already happened once).
- Wants PersonalOS to eventually be **proactive** (briefs, nudges, reminders), not just respond when spoken to.
- A small web app is not off the table long-term, but deferred until a specific feature genuinely needs it (Plaid Link, charts, browsable history). Default output surface for now stays Shortcuts.
- Budget-conscious: wants to keep every tool free (Vercel, Supabase, GitHub, VS Code, Shortcuts). Only paid line item is the OpenAI API key.

**Working style Claude Code should carry forward:** explain the "why" before the "what," make one change, help test it, confirm before moving to the next. Don't let iteration speed replace the builder's understanding — if changes start moving faster than they can follow, say so explicitly.

---

## What's built and confirmed working (tested, not just written)

### Core loop
- Apple Shortcut → `/api/capture` → OpenAI (`gpt-4o-mini`) planner → structured JSON → `router.js` → tool execution → Supabase logging.

### Reliability (Phase A — complete)
- **Failure logging is real.** `router.js` wraps tool execution in try/catch; `activity_logs.success` reflects actual outcome, `error_message` and `duration_ms` are populated on failure. Previously every failure was invisible — `success: true` was hardcoded.
- **`general_question` route exists** (`tools/answer.js`). Previously this was a dead code path — the AI could return it but the router had no case, so any question (not a command) failed with "Unknown tool." Now answers using memory context, and is explicit that it *cannot* see calendar/tasks/finances (prevents the model from confidently inventing a fake schedule).
- **The original user's raw text is passed through the router** (`executeTool(data, originalText)`), not just the AI's JSON. This fixed a real bug where the planner would paraphrase or attempt to answer the question itself inside the `question` field, corrupting downstream tools. Any new Mode B (answer-generating) tool should follow this same pattern — pass `originalText` through rather than trusting the planner's reconstruction of user intent.
- **Timezone is read from `profiles.timezone`**, not hardcoded. Single lookup function in `lib/profile.js` (`getProfile()`, `getUserTimezone()`) that every tool calls independently (deliberately self-contained, not passed down from `capture.js`, because background/cron jobs won't route through `capture.js` later). Falls back to `America/Los_Angeles` if the lookup fails — never hard-fails a create over a profile read error.
- **Idempotency / duplicate protection is live.** Unique Postgres indexes on `calendar_events.google_event_id` and `tasks.google_task_id` (partial indexes, `where ... is not null`). Plus application-level duplicate detection (`findRecentDuplicateEvent`, `findRecentDuplicateTask` in `tools/database.js`) — checks for same title + same time within a 2-minute window before creating. Returns `{success: true, duplicate: true}` rather than an error, since from the user's perspective the thing they wanted already exists.

### Read path (Phase B — in progress)
- **Google Calendar read works** (`getEvents()` in `tools/googleCalendar.js`). Uses `singleEvents: true` to expand recurring events into actual occurrences (required — without it you get recurrence rules, not real meetings). Slims Google's payload down to `{id, title, start, end, allDay, location}` before it ever reaches the AI — full Google event objects are large and mostly noise for this use case.
- **`query_schedule` tool works and has been tested for actual reasoning, not just listing** — confirmed it can correctly answer "am I free Thursday afternoon" by reasoning about gaps between events, not just reciting them. Formats event times as human-readable strings (`"Thu Aug 6, 2:00pm to 3:00pm"`) before sending to the model — deliberately not raw ISO timestamps, which the model reasons about worse.
- **Google Tasks read (`getTasks()`) and `query_tasks` tool are written but NOT yet tested.** This is the immediate next step when work resumes. Known limitation already identified: Google Tasks API only stores a due *date*, not a time — so a task created with "tomorrow at 9am" will show due tomorrow with no time attached on the Google side. Supabase's `tasks.due_date` does retain the full timestamp, which may matter later (e.g., if reminders end up driven from Supabase instead of Google).

### Known limitation, not yet fixed — by design, for now
- `/api/capture` and `/api/testCalendarRead` have **no authentication**. Anyone with the URL could read the calendar or create/pollute data. Builder has explicitly decided this is acceptable for now (worst case is exhausting a $10 OpenAI balance with auto-refill off) and wants to defer real auth until later. **Do not "fix" this unprompted** — it's a known, accepted tradeoff, not an oversight.

---

## What's NOT built yet (don't assume it exists)

- Two-way sync — nothing reads back changes made in Google (task checked off, event moved/deleted in the Google app) into Supabase. Calendar and task completion state can silently diverge.
- Background/scheduled execution (no Vercel Cron yet). Everything is still request-response only.
- Any output surface other than whatever the calling Shortcut displays. No `briefs` table, no push mechanism (and note: a server cannot push to a phone — any proactive feature needs a pull-based pattern, phone-side scheduled Shortcut checking a stored result).
- `general_question` and `query_schedule`/`query_tasks` are separate ad hoc tools bolted onto a single-tool-per-request router. Multi-tool-per-utterance and native OpenAI function-calling (replacing the inline JSON-schema-as-prompt-text approach) have been discussed as a near-term improvement but not started.
- `goals`, `projects`, and most of `profiles` are empty/unused tables — schema exists, nothing writes to them yet.
- Notes, transactions/finances, people/relationships — no tables, no code. Financial data source is undecided in practice (Plaid was explored and understood, but paused in favor of finishing base infrastructure first).
- Memory retrieval is still "top-N by importance, blanket-injected into every prompt" — not query-routed, not embedding-based, no contradiction handling.

---

## Two dead files — known, deliberately not yet cleaned up
`calendar.js` and `tasks.js` (short stub files, distinct from `googleCalendar.js` / `googleTasks.js`) return fake success responses and aren't called from `router.js` or anywhere else seen so far. Builder is aware and has chosen to leave them for now rather than clean up mid-flow. Don't be confused into thinking these are the real integration files.

---

## Immediate next step when work resumes

**Test `query_tasks`** (untested, written):
```bash
curl -X POST http://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -d '{"text": "what tasks do I have"}'

curl -X POST http://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -d '{"text": "am I behind on anything"}'
```
Worth watching which tool the router picks for ambiguous phrasing like "what's on my plate" — it can currently only choose calendar *or* tasks per request, not both. That ambiguity is expected and is one of the reasons multi-tool calling is on the near-term list.

**After that**, per the architecture doc's build order: Phase C (Vercel Cron + background execution) → Phase D (the morning brief — first proactive, end-to-end feature, deliberately chosen as the forcing function that exercises the read path + background execution + output delivery together).

---

*Read this alongside `PersonalOS-Architecture-Source-of-Truth.md` for the long-term design reasoning. This document is the "where things actually stand," that one is the "why it's built this way and what's next." Update this one as state changes; the architecture doc should stay mostly stable unless a major decision changes.*
