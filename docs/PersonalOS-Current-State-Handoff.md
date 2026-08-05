# PersonalOS — Current State Handoff

**Date:** August 5, 2026
**Purpose:** Bring a new assistant up to speed on exactly where this project stands. Read alongside `PersonalOS-Architecture-Source-of-Truth.md` (the *why*). The system changed enormously across two long sessions on Aug 4–5 — **do not trust anything dated before Aug 5 without checking it against live code.**

---

## About the builder

- Blake, 19, Illinois State University (Business Marketing, rising sophomore). Full profile lives in `profiles.bio` in Supabase and is fed to every reasoning tool via `buildRichContext()`. **Read the field, don't re-derive it.**
- No formal coding background. Wants high-level explanations ("what does this file do and how does it connect"), not line-by-line walkthroughs.
- **Standing tone rule:** blunt, hold nothing back, no topic off-limits, never soften a finding for comfort. Applies to every judgment/synthesis tool.
- **Model selection: standing discretion granted.** Pick the best fit without asking; economize only when the cost delta is real.
- **Cost target: under $10/month all-in.** Currently tracking ~$6.50–7.50.
- **Working style he asked for explicitly (Aug 5):** be independent, ship related features in batches, test thoroughly, report back in one go. Don't ask permission for things that are clearly within an agreed direction.

---

## What's built and working

### The spine
Shortcut → `/api/capture` → `gpt-5.4-mini` router (native tool calling) → `lib/router.js` → tool → Supabase logging. ~16 tools.

### Reading
`query_schedule`, `query_tasks`, `query_notes`, `query_projects`, `query_finances` — all read live from source, format for a reader, synthesize. **Overdue/late classification happens in code, never in the model.**

### Writing and changing
Create tasks/events. **`modify_task` / `modify_event`** complete, reschedule, delete — resolved from natural language ("the dentist thing"), with a real ambiguity path. Keyed off **Google IDs, never Supabase IDs** (most items exist only in Google).

### Money
**SimpleFIN** ($15/yr, read-only). `lib/simplefin.js` + `tools/finances.js`. Live reads, no mirror — no new table needed. Every figure computed in code.

### Memory that grows
`respondToThread` extracts durable facts and forward-looking wants from conversation and writes them to memories/intentions — **free, rides inside the existing reply call**. Weekly bio regeneration (Sundays) with heavy preservation guards.

### Proactive mode (new, Aug 5)
- **Web push** — `lib/push.js`, `web/public/sw.js`, manifest, `PushSetup.js`. $0, no vendor. **Verified delivering to Blake's phone.**
- **Location** — `tools/location.js`, `api/ingest/[kind].js`. Overland-compatible. Clusters points into places, prompts for labels after 3 visits.
- **Timezone follows location** once settled (18h agreement required).
- **Daily metrics** — `tools/metrics.js`, one row per day across all domains. The substrate correlation needs.
- **The observer** — `tools/observer.js`. Once daily, decides whether anything deserves an interruption. **Silence is the default.**

### Background
One cron file (`api/cron/[job].js`, dynamic route). `reviewIntentions` runs: completions → nudges + cascade → metrics → observer → (Sundays) bio regeneration.

---

## Hard constraints — read before building

- **`api/` is at 11/12 serverless functions.** Vercel Hobby caps at 12. Any new endpoint must fold into an existing file or a dynamic route. `api/ingest/[kind].js` and `api/cron/[job].js` are the patterns.
- **Supabase DDL is not reachable through PostgREST.** New tables require Blake to paste SQL into the Supabase dashboard. `docs/schema-additions.sql` is the precedent.
- **`web/` is a separate Vercel project with its own function budget, largely unused.** Read-only dashboards can query Supabase directly and cost zero backend functions.
- **`web/` does not auto-deploy.** After changing it: `cd web && npx vercel --prod --yes`.
- **Auth is live.** All data endpoints require `x-pos-key`. Location ingest additionally accepts `?key=` with a **separate scoped token** (`LOCATION_INGEST_KEY`) because Overland cannot send headers.
- **`sw.js`, `manifest.json`, `icon.svg` must stay excluded from the `proxy.js` matcher** — the browser fetches them outside the page session.

---

## Traps that have already bitten, twice each

1. **Google Tasks stores a DATE, returned as UTC midnight.** Reading it as a timestamp west of UTC rolls every due date back a day. Use `taskDueDate()`, and compare due-vs-today as `yyyy-MM-dd` **strings**, never instants.
2. **`getEvents` defaults to `maxResults: 50`** and expands recurring events per occurrence — a wide window silently truncates and reports "not found".
3. **Never let a model do arithmetic and then narrate it.** This produced "you're behind on X" contradicting itself mid-sentence. Compute, then hand the figure over as fact.
4. **A client timeout does not mean the server failed.** A timed-out `buildPlan` had succeeded; the retry built a second project with real Google tasks.
5. **Single-sample evals hide flakiness.** "Move my dentist appointment to Thursday" passed once and still failed in production. Run routing evals 4× per phrase, and have the eval parse the real prompt out of `api/capture.js` so it can't drift.
6. **Completed Google tasks are invisible to the normal read path** — test residue survives cleanup and pollutes completion history.

---

## Cost model (target: under $10/mo)

| Item | Monthly |
|---|---|
| Vercel Hobby, Supabase Free, Google APIs, web push, Overland | $0 |
| SimpleFIN | $1.50 |
| OpenAI | ~$3 today → $5–6 with everything |
| **Total** | **≈ $6.50–7.50** |

**The budget risk is not a subscription — it is OpenAI context bloat.** Every new source enlarges `buildRichContext()`, which is fed to *every* nudge, question and thread reply. This is what makes **retrieval-based memory the budget control**, not an optimization.

---

## Model tiering

- `gpt-5.4-mini` — routing, all query tools
- `gpt-5.6-terra` — threads, plan building, nudges, general questions, finances, observer, bio regeneration
- `gpt-5.6-sol` — the opening deep-thinking analysis only
- `gpt-5.6-luna` — **do not use for routing.** Cannot use function tools in chat.completions except with `reasoning_effort: "none"`, and ~2.5× slower.

---

## Agreed direction, in order

1. **Consolidate the remaining `api/` files.** Auth pair → one (**needs Blake to update the Google Cloud Console redirect URI**), six resource endpoints → one or two (needs `web/` updated in the same change).
2. **Retrieval-based memory (S6).** Now the budget control, not a nice-to-have.
3. **Correlation engine** — once `daily_metrics` has 4–8 weeks. **Do not ship trend claims before then.**
4. **Skill challenges** — record a 1-min pitch, analyse filler words/contradictions. Deferred by agreement until push and location are proven.
5. Live web search for planning materials (approved long ago, never built).

### Product decisions already made — don't re-litigate
- **Interruption budget: one digest a day + genuinely urgent only.** He said twenty a week "takes the magic out of it". A muted app kills every other feature.
- **Autonomy: propose, never write without a yes.** Calendar is a real commitment surface.
- **Location: continuous** (chosen twice), via Overland, 15 min / 2h overnight.
- **Push: Web Push, not Pushcut.** Pushcut is ~$2–4/mo for the same outcome.
- **Apple Health: dropped** — he doesn't use it.

---

## Honest state of the data

This is a system that has been **built far faster than it has been lived in.** As of Aug 5: 7 memories, 1 intention, 0 projects, 2 deep thoughts, 9 recovered task completions, 30 days of transactions, 0 location points.

**Every proactive feature works and is waiting on data.** The observer will be quiet and the correlations will be absent until weeks of history accumulate. That is correct behaviour, not a bug — and the system is explicitly instructed not to invent patterns below 14 days of history, because a fabricated correlation is how it would permanently lose his trust.

The single highest-value thing for this project is not another feature. It is Blake using it daily.
