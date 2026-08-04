# PersonalOS — Architecture & Design Source of Truth

**Version:** 1.1
**Date:** August 2, 2026
**Purpose:** The reference document for *why* PersonalOS is built the way it is, what each future feature actually requires, and what order things should be built in. This supersedes feature wish-lists. Read this before starting any new feature.

---

## 0. How to use this document

The roadmap lists **what** to build. This document covers **what has to exist first**, which is a different and more important question.

The core finding: almost none of the roadmap features are blocked by their own complexity. They are blocked by three missing system-wide capabilities. Building those three unlocks most of the roadmap at once. Building features first, without them, means building each one twice.

---

## 1. Honest state of the system today

### What genuinely works
- Natural language → structured JSON via OpenAI (`gpt-4o-mini`)
- Tool routing for three actions: `create_event`, `create_task`, `save_memory`
- Supabase-first write pattern for calendar and tasks (source of truth, with `google_*_id` written back)
- Memory storage and blanket injection into every prompt
- Activity logging on success

### What does not exist yet
| Capability | Status |
|---|---|
| Reading data back out of Supabase | ⚠️ Partial. `memory.js` + `context.js` read `memories` and inject them into every prompt. Works, but it's fixed context injection — not a query tool the AI can invoke, and no other table is ever read. |
| Updating or deleting anything | ❌ None. |
| Reading from Google (calendar/tasks state) | ❌ None. Push-only. |
| Running without a user prompt | ❌ None. Fully request-response. |
| Failure logging | ❌ `router.js` hardcodes `success: true`; thrown errors never reach `activity_logs`. |
| Multiple tools in one utterance | ❌ One JSON object, one tool. |
| Anything writing to `goals`, `projects`, `profiles` | ❌ Tables exist, unused. |

### Live defects worth fixing
- **`general_question` is a dead route.** The system prompt in `capture.js` instructs the AI to return `{"tool":"general_question"}`, but `router.js` has no case for it — it falls through to `default` and returns "Unknown tool." Any non-command question to PersonalOS currently fails.
- **Failures are invisible.** Because `success: true` is hardcoded and `logActivity` runs after the tool call, a thrown error produces a 500 with no log record. For a system that will eventually run unattended background jobs, this is the highest-priority debt in the codebase.
- **Timezone is hardcoded in ~4 places** even though `profiles.timezone` exists as a column. Should be read once from the profile.
- **No idempotency protection.** A duplicate event has already occurred once in testing. There are no unique constraints or request keys preventing repeats. This becomes serious the moment anything retries automatically.
- **Dead stubs:** `calendar.js` and `tasks.js` shadow the real `googleCalendar.js` / `googleTasks.js`. Known, deferred.

---

## 2. The central insight: three modes of operation

Everything PersonalOS will ever do falls into one of three modes. The system currently supports one of them.

### Mode A — **Act** *(built)*
> "Add coffee with Brad Friday at noon."

One utterance → one structured payload → one write. This is the entire current system.

### Mode B — **Retrieve & Synthesize** *(not built)*
> "What did I spend on food this month?"
> "What's on my plate this week?"
> "Should I take this internship?"

Read many rows → reason across them → return prose. Fundamentally different from Mode A: the output is an *answer*, not a record. Requires query tools, a way to bound how much data enters the prompt, and prompt design for analysis rather than extraction.

**Blocked features:** financial reports, calendar conflict detection, life reviews, decision assistant, note recall, relationship prompts. That is most of the roadmap.

### Mode C — **Observe & Initiate** *(not built)*
> "You haven't touched your business tasks in 11 days."
> Monday morning brief.
> Deep-thinking project breakdown delivered 10 minutes after you asked.

Runs on a schedule or trigger, with no user present. Requires scheduled execution, job state, and a delivery channel. Vercel serverless is request-response only — this needs Vercel Cron and, for long-running work, a job record the request can hand off to.

**Blocked features:** weekly/monthly reviews, neglected-task detection, deep thinking workflows, location triggers, relationship follow-up nudges.

**The whole roadmap is a request for Modes B and C.** That framing should drive build order.

---

## 3. The spine — infrastructure every feature depends on

Ranked by how many roadmap features each unlocks.

### S1. Read path / query tools *(unlocks the most)*

**Starting point is better than it looks.** A Supabase read path already exists and works: `memory.js` (`getMemories`, `getFormattedMemories`) → `context.js` (`buildContext`) → injected into every prompt. The plumbing is proven. What's missing is generalizing it.

Four specific limits on today's read path:
1. **Not routable** — the AI cannot decide to look something up. It receives the same top-N memories regardless of what was asked.
2. **Single table** — only `memories`. Nothing reads `calendar_events`, `tasks`, `goals`, or `projects`.
3. **Not parameterized** — `getMemories(limit)` takes a count. No date ranges, filters, or search.
4. **No answer path** — even with data in context, `router.js` has no case that returns a synthesized answer instead of executing an action (the dead `general_question` route).

What to build:
- Query functions per domain (`getUpcomingEvents`, `getTasksByStatus`, `getTransactionsInRange`, `searchNotes`) — same shape as the existing memory getters
- Expose them as **callable tools**, not just automatic context
- A **result budget** — never inject unbounded rows into a prompt. Cap, summarize, or pre-aggregate in SQL.
- A second prompt style: analysis/summarization, not JSON extraction

**Still the single highest-leverage piece of work remaining** — but it's an extension of a working pattern, not a from-scratch build.

### S2. Two-way sync + idempotency
Currently Google is written to and never read from, so anything changed in Google (task checked off, event moved or deleted) silently diverges from Supabase. Needs:
- A pull/reconcile function per integration
- Scheduled reconciliation (depends on S3)
- Unique constraints on `google_event_id` / `google_task_id`, plus an idempotency key on inbound requests
- A conflict rule: **last-write-wins, Supabase authoritative on conflict** (recommended — simplest defensible rule)

### S3. Background execution
Vercel Cron endpoints (`/api/cron/*`), protected by a secret header. Plus a `jobs` table for anything exceeding function timeout: request creates a job row → returns immediately → cron worker processes → result stored → user retrieves.

### S4. Scalable tool routing
The current design puts every tool's JSON schema inline as text in one giant system prompt. At 3 tools this is fine. At 15 it is expensive, brittle, and the model starts confusing formats. Migrate to **OpenAI native tool/function calling**, which:
- Moves schemas out of the prompt into structured definitions
- Enables **multiple tool calls per utterance** ("add the meeting and remind me to bring the contract")
- Gives better format compliance for free

### S5. Output surface *(resolved — deferred web app, pull-based delivery)*
Modes B and C produce long-form output: a monthly review, a project breakdown, a spending report. Apple Shortcuts can display text but is a poor reader for 1,000+ words, cannot render tables or charts, has no history, and cannot host Plaid Link.

**Resolution:** no web app yet. Build the *delivery* half first, using a pattern that works today and doesn't have to be thrown away later:

```
Vercel Cron (server)        →  computes brief / detects nudge
        ↓
Supabase `briefs` table     →  result stored, unread flag
        ↓
Shortcuts time automation   →  phone pulls on schedule
        ↓
Notification / spoken / Apple Note
```

Critical detail: **the server cannot push to your phone. The phone pulls.** So heavy work runs server-side on cron and *stores* a result; a scheduled Shortcuts automation fetches it. This decouples computation from delivery, avoids the function timeout, and means the same stored output is instantly available to a web app later without rework.

**The web app becomes necessary when** you want: charts, Plaid Link, browsable note/transaction history, or interactive follow-up on a report. Revisit at that point, not before.

### S6. Retrieval-based memory
Today: top 20 memories by importance, all injected into every prompt. Problems at scale — cost grows linearly, irrelevant memories dilute attention, contradictions accumulate ("prefers X" vs. later "prefers Y"), `expires_at` is unused.

Direction: embeddings + semantic search (Supabase supports `pgvector`), retrieve only what's relevant to the current utterance, plus a conflict-resolution pass so updated preferences supersede rather than coexist.

### S7. Entity graph
The roadmap repeatedly asks for connection: notes→projects, tasks→goals, people→interactions, spending→goals. Decide the mechanism **once**:
- **Recommended:** a generic `entity_links` table (`from_type`, `from_id`, `to_type`, `to_id`, `relationship`) alongside the existing direct foreign keys. Direct FKs for the hot paths already in the schema; the link table for everything sparse and many-to-many.

### S8. Observability
Fix failure logging, log token/cost per call, add a duration metric. Once Mode C exists, silent background failures are the default failure mode — you will not notice a cron job that has been dead for three weeks unless the system tells you.

---

## 4. Feature-by-feature analysis

### 🧠 Adaptive Memory System
- **Depends on:** S6. Nothing else.
- **Hidden difficulty:** "Automatically determines what's worth remembering" requires a *second* LLM pass over each interaction deciding what to extract — doubling cost per request unless batched. Contradiction handling is the part everyone skips and regrets: without it, memory rots into a pile of conflicting claims.
- **Verdict:** Highest leverage per unit of effort, because every other feature reads from it. Do the retrieval upgrade early; auto-extraction later.

### 📍 Location-Based Intelligence
- **Depends on:** Shortcuts location automations (easy) + accumulated history (hard).
- **Hidden difficulty:** Every example in the roadmap ("you usually buy protein here", "log your workout") depends on historical data that isn't being collected yet. Without it, this reduces to geofenced reminders — which iOS already does natively, for free.
- **Verdict:** Lowest real value right now despite being the flashiest. Defer until finances/notes/habits give it something to actually say.

### 📅 Intelligent Calendar Management
- **Depends on:** S1, S2.
- **Hidden difficulty:** Requires reading the full calendar, not just writing to it. "Overloaded day" needs a definition you must invent and tune. Suggestions introduce a genuinely new interaction pattern — **proposing** an action and waiting for confirmation, rather than executing immediately.
- **Verdict:** The natural forcing function for building the read path. Strong candidate for next major feature.

### ✅ AI Task Management
- **Depends on:** S1, S2, S3.
- **Hidden difficulty:** "Neglected task" detection is trivial logic once data exists. The real blocker is that completion status is one-way today (already identified). Urgency/importance ranking needs `goal_id`/`project_id` populated, which nothing currently does.
- **Verdict:** Shares ~80% of its infrastructure with calendar management. Build the two together.

### 🎯 Deep Thinking Project Workflows
- **Depends on:** S3, S5, plus `goals`/`projects` actually being populated.
- **Hidden difficulty:** Multi-minute reasoning does not fit inside a serverless request timeout — this is the feature that forces the jobs table. Output is 1,000–3,000 words of structured plan, which Shortcuts cannot present usefully.
- **Verdict:** Highest wow-factor, heaviest infrastructure cost. Best *first* async feature — but only after S3 and S5 exist.

### 📝 AI Note System
- **Depends on:** `notes` table, S6 (shared embedding/retrieval), S7.
- **Design fork to decide now:** are notes and memories one store or two? **Recommendation: two tables, one retrieval layer.** Memories are facts *about you* used to personalize behavior; notes are content *you authored* and want to find later. Different lifecycles, different write triggers — but identical embedding/search infrastructure.
- **Verdict:** Capture is trivial. All the value is in retrieval and linking, which is S6/S7 work.

### 💰 Financial Intelligence
- **Depends on:** `transactions` table, S1, a data source (Plaid / CSV / manual — interchangeable).
- **Hidden difficulty:** The report generator is the actual feature; the ingestion pipeline is a swappable detail. Categorization quality determines whether "trends" mean anything — bad categories produce confident nonsense.
- **Verdict:** Build the report against seeded test data first, choose the pipeline second. The reporting logic does not change based on data source.

### 📊 Weekly / Monthly Life Reviews
- **Depends on:** S1, S3, and meaningful data density across calendar, tasks, finances, goals.
- **Hidden difficulty:** Output quality is capped by input density. A "review" over three weeks of sparse data reads like a horoscope — vague enough to be true, useless enough to ignore. This is a data problem masquerading as a prompt problem.
- **Verdict:** Capstone feature. Consider a deliberately shallow v1 early (calendar + tasks only) to force the read path, then deepen as data accumulates.

### 👥 Relationship Management
- **Depends on:** `people` table, S1 (calendar read), entity extraction, S7.
- **Hidden difficulty:** Interaction history has to populate itself — from calendar attendees, from notes mentioning people. Any design requiring manual logging of interactions will be abandoned within two weeks. That's not a discipline problem, it's a design problem.
- **Verdict:** Only viable if fed automatically. Defer until calendar read + notes exist.

### 🤖 Personal Decision Assistant
- **Depends on:** Everything above.
- **Hidden difficulty:** Technically none — it is a prompt over accumulated context. Its quality is a *direct function* of how much real data the rest of the system has captured.
- **Verdict:** Not a feature to build so much as a **measurement of whether the system worked.** It becomes possible on its own. Treat it as the success metric, not a milestone.

---

## 5. Dependency map

```
                    ┌──────────────────────────┐
                    │   S1  READ PATH          │  ← highest leverage
                    │   (query + synthesize)   │
                    └──────────┬───────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
  Financial reports     Calendar intel          Note recall
        │               Task intel                    │
        │                      │                      │
        │              ┌───────┴────────┐             │
        │              │ S2 TWO-WAY SYNC│             │
        │              └───────┬────────┘             │
        │                      │                      │
        └──────────┬───────────┴──────────┬───────────┘
                   │                      │
                   ▼                      ▼
        ┌──────────────────┐   ┌────────────────────┐
        │ S3 BACKGROUND    │   │ S5 OUTPUT SURFACE  │
        │    EXECUTION     │   │   (decision open)  │
        └────────┬─────────┘   └─────────┬──────────┘
                 │                       │
                 └───────────┬───────────┘
                             ▼
              Deep thinking · Life reviews
              Relationship nudges · Location
                             │
                             ▼
                 🤖 Decision Assistant
                  (emerges, not built)
```

**Supporting throughout:** S4 (tool routing) should be migrated before tool count exceeds ~6. S6 (memory retrieval) and S8 (observability) improve everything and can be done in parallel at any time.

---

## 6. Recommended build order

*Revised in v1.1 for a proactive, daily-driver system.*

| Phase | Work | Why here |
|---|---|---|
| **A** | **Reliability floor:** real failure logging; `general_question` route; timezone from `profiles`; idempotency constraints | Promoted to first. A daily driver that fails silently is worse than no system — and duplicates land in a real calendar |
| **B** | **S1 read path** — query tools + synthesis prompt style, starting with **Google Calendar read** | Highest leverage; starting with calendar read also lays the first half of two-way sync |
| **C** | **S3 background execution** — Vercel Cron + `briefs` table + Shortcuts pull automation | Proactive is a stated requirement, so this is core infrastructure, not optional |
| **D** | **Morning brief** — first true Mode C feature, end to end | Perfect forcing function: exercises S1 + S3 + S5 together, and is useful every single day |
| **E** | **S2 two-way sync** — reconcile task completion and event changes back from Google | Daily reliance makes divergence painful fast; now cheap because calendar read exists |
| **F** | **S4 native tool calling + multi-tool** | Do before tool count exceeds ~6 |
| **G** | Data capture expansion: notes, transactions pipeline, people | Feeds the synthesis layer |
| **H** | **S6 memory retrieval upgrade** | Before memory count makes blanket injection untenable |
| **I** | Synthesis features: reviews, deep thinking, relationships, location | All now unblocked |

### The reliability bar changed
Daily reliance raises the standard on things that were previously cosmetic:
- **Fail loudly, to you.** A failed cron job must surface in the next brief, not just in a log table you never open.
- **Idempotency is mandatory,** not defensive. Retries + background jobs + a real calendar = duplicate events you have to clean up by hand.
- **Propose, don't execute, for anything destructive.** Deleting or moving real commitments needs confirmation, which is a new interaction pattern (see §4, Calendar).
- **Degrade gracefully.** If Google is down or a token expires, the brief should still deliver what it can and say what's missing.

---

## 7. Data model direction

**Existing and in use:** `memories`, `calendar_events`, `tasks`, `activity_logs`
**Existing and unused:** `profiles`, `goals`, `projects` — populate these before building anything that claims to connect actions to goals
**Needed:** `notes`, `transactions`, `people`, `jobs`, `entity_links`, `places` (if location proceeds)

**Conventions to adopt now, while it's cheap:**
- Every table gets `created_at` / `updated_at` (mostly present already)
- Every externally-synced record gets `external_id` + a unique constraint
- Every table gets `user_id` — even single-user. Retrofitting this later is painful; adding it now costs nothing.
- Timestamps stored UTC, timezone resolved at display from `profiles.timezone`
- Soft delete (`deleted_at`) over hard delete for anything the AI reasons over historically

---

## 8. Cost & model strategy

Current: everything runs on `gpt-4o-mini`. Correct for routing — it is cheap and extraction is easy.

Synthesis is a different job. Weekly reviews, deep-thinking breakdowns, and decision analysis reward a stronger model. Plan for **tiered model selection**: cheap model for routing and extraction, stronger model for analysis and long-form generation, invoked deliberately rather than by default.

Cost discipline to build in from the start:
- Cap context injection (memory retrieval instead of blanket injection — S6)
- Pre-aggregate in SQL rather than sending raw rows to the model
- Log tokens per call in `activity_logs` so cost is visible before it's a surprise

---

## 9. Privacy & security posture

The roadmap moves PersonalOS from "calendar events" to **finances, relationships, personal notes, and decisions** — the most sensitive data you'll ever put in it.

- Supabase currently uses the **service key**, which bypasses Row Level Security entirely. Acceptable for a server-only, single-user system. **Not acceptable the moment a browser-based frontend exists** — that requires RLS and anon-key auth.
- Never send secrets or tokens to the LLM. Financial *totals* and *categories* are fine; account numbers and access tokens are not.
- If Plaid or any bank link proceeds, its access tokens are the highest-value secret in the system — encrypted at rest, never logged, never in `activity_logs`.
- `activity_logs` currently stores full input/output JSON. Once notes and finances flow through the router, that table becomes a plaintext archive of everything. Consider redaction rules or a retention window.

---

## 10. Open decisions

### ✅ Resolved (v1.1)

1. **Output surface — web app deferred.** Not off the table, but only when a feature genuinely demands it (charts, Plaid Link, browsable history, interactive follow-up). Until then: cron computes → Supabase stores → Shortcuts pulls. See S5.
2. **Proactive — yes.** Briefs, nudges, reminders. **Consequence: S3 background execution is promoted from optional to core infrastructure,** and moves to Phase C.
3. **Daily driver — yes.** **Consequence: the reliability floor moves to Phase A.** Failure logging, idempotency, and graceful degradation stop being cleanup and become prerequisites. See §6.

### ⬜ Still open

4. **Notes vs. memories** — recommendation is two tables, one retrieval layer (§4). Confirm or override.
5. **Sync conflict rule** — recommendation is Supabase-authoritative, last-write-wins. Confirm or override.
6. **AI spend ceiling** — a monthly number, so tiered model selection can be designed against a real constraint. More pressing now: proactive means the system spends money on schedule whether or not you use it that day.
7. **Brief cadence and content** — what time, and what's in it? Shapes the first Mode C feature directly.

---

## 11. Principles & anti-patterns

**Carried forward from the original handoff (still correct):**
- One architectural change at a time. Test locally. Confirm. Commit.
- Supabase is the source of truth. External services are integrations, never the database.
- Prefer boring, reliable systems over clever ones.
- Don't refactor working systems without a reason.

**Added, based on where this roadmap leads:**
- **Infrastructure before features.** Three missing capabilities block most of the roadmap. Features built without them get rebuilt.
- **Any feature requiring manual data entry will be abandoned.** If a feature only works when you diligently log something, it does not work. Design for automatic capture or don't build it.
- **Synthesis quality is a data problem.** "The review isn't insightful" almost always means there isn't enough data, not that the prompt is wrong. Resist fixing prompts when the answer is more data.
- **Distrust flashy-but-hollow features.** Location intelligence is the clearest example — impressive demo, nothing real to say until history exists.
- **Silence is the default failure mode of background jobs.** Anything that runs unattended must report that it ran.

---

*Update this document when an open decision is resolved or a phase completes. It should stay the answer to "why is it built this way," not a changelog.*
