# PersonalOS — Roadmap, August 8 2026

**Purpose:** A working list of what to build next, written for a single long coding session rather than as an exhaustive product plan. Grouped by how big a bite each thing is, not by category — pick a size that matches the hours you have left. Cross-reference `PersonalOS-Premortem.md` before starting anything marked ⚠️: that doc explains the risk in more depth than this one will.

Nothing here is committed to. This is a menu, not a backlog.

> **Update, Aug 9.** An audit (`PersonalOS-Intelligence-Audit-2026-08-08.md`) reordered the top of this list around what the code turned out to actually need. Three items below are now **done**, and they are struck through where they appear. The audit's own phased plan supersedes this document for anything touching the intelligence layer; this file remains the menu for everything else.
>
> Done Aug 9: the graph as a real query surface (`walk`/`resolveReference` — the "Big" item), location connected to the rest of the day (the "Medium" item), and the beginnings of the ambiguous-capture resolver (the other "Medium" item — `resolveReference()` exists; nothing calls it from the capture path yet).

---

## Loose ends from Aug 8

Small, and arguably should go first since they're already half-scoped:

- **Facts-about-me confirmation pass** (queued since Aug 6, never run). A widget presenting inferred facts about you for yes/no confirmation, to backfill `profiles.bio` faster than organic use alone. Straightforward to build — the harder part is deciding which facts are worth asking about, given a wrong inferred fact treated as true is worse than a gap.
- **Verify the Calendar auto-colour toggle actually round-trips in production.** It was built and verified locally against a credential-less environment where every save silently fails (documented in the handoff doc) — the code path mirrors the already-shipped interruption-level control exactly, but a real save-then-reload check on your phone is still worth five minutes.
- **The event-colour map is currently fixed** (meeting→peacock, etc.). If the assignments feel wrong once you've lived with them, `lib/eventKind.js`'s `KIND_COLOR` is a five-line edit — no reason to build a picker UI unless you actually want to change it per-event rather than per-kind.
- **`restCategories`/`restMerchants` on the money page use plain rows, not the ranked bars.** If a category regularly has 8+ entries in practice, worth deciding whether the "more" disclosure should get its own mini bar chart instead of bare text rows.

---

## Small (an hour or two each)

- **Merchant-level override for miscategorised spending.** `lib/categorize.js` classifies by rule then falls back to a cached model call. There's no way to correct a wrong classification without editing code. A `merchant_overrides` table plus a tap-to-recategorize affordance on the money page would close that loop — and since it's keyed on the merchant string, one correction fixes it for every future transaction from that merchant.
- **Recurring-charge cancel nudge.** `findRecurring()` already surfaces subscriptions. The natural next step is a periodic pass asking "still using this?" for anything not mentioned in a memory or note in 60+ days — reuses the observer/prompt infrastructure that already exists for place-labelling.
- **A `/practice` streak or cadence signal**, mirroring what `people.js` already does for relationships — "you argued three topics this week" is the same shape of fact `lib/signals.js` already computes for spending and tasks.
- **Wire `MoneyAsk` (and general_question) through the digest.** Right now a financial question answered in-app has no path back into the morning brief's cross-domain awareness. If you ask "how much did I spend on the move" today, tomorrow's brief has no idea that conversation happened.
- **Push notification action buttons.** Web Push supports actions (`notification.actions`) — "Snooze" or "Done" directly on a nudge notification, without opening the app. Small addition to `lib/push.js` and `public/sw.js`'s `notificationclick` handler.

---

## Medium (most of a day)

- **Deepen the "Jarvis" personality further.** The brief already infers meeting-vs-block-vs-reminder and weaves in cross-domain signals. The next layer is proactive *synthesis across insights themselves* — right now each `tools/islands.js` detector fires independently; nothing yet notices that a `relationship_debt` finding and a `project_cost` finding are about the same project and worth saying together.
- **A real settings page for the interruption budget, per-kind rather than one global dial.** `URGENCY_TIERS` in `lib/settings.js` is currently a hardcoded map from kind → tier. Making that user-editable ("I want relationship nudges but not spending insights") is a real feature, not just a refactor — but it also reopens the exact bug class the tiers table was built to prevent (a kind silently falling out of sync with what the UI thinks it configured). Write a test alongside this one, not after.
- **A Plaid evaluation, kept separate from a Plaid migration.** SimpleFIN is $15/yr flat and works. Plaid costs per connection but supports more institutions and richer transaction metadata (real MCC codes instead of merchant-string guessing, which would make `categorize.js`'s rule table mostly unnecessary). Worth a spike to see whether the metadata quality actually reduces the "unknown merchant → model call" rate enough to matter, before committing to the cost.
- ~~**Location-based automatic capture.**~~ **Done Aug 9** — points become visits, visits get durations, and a visit overlapping a calendar event becomes a `located_at` edge. A presence signal now rides in every reasoning call. The "you were somewhere for three hours and nothing got logged" nudge is now buildable: the facts it needs exist and are computed.
- **A real "what did I mean by that" resolver for ambiguous captures.** ~~The entity graph already has everything needed; nothing currently calls it.~~ **Half done Aug 9** — `resolveReference()` in `lib/links.js` does the resolution and returns ranked candidates with an honest ambiguity flag. What remains is the *capture-path* half: `tools/pending.js` asking the question when `unambiguous` is false, and acting when it is true.

---

## Big (multi-day, worth a real design pass before starting)

- ⚠️ **Testing investment**, per the premortem's #1.4. There are 97 fast unit/integration tests and zero end-to-end coverage of the actual capture → route → tool → write pipeline against a real (or realistically mocked) Supabase and Google API. Everything shipped today was verified by hand in a browser. That doesn't scale, and it's the single highest-leverage unglamorous thing on this list.
- ⚠️ **Auth**, per the premortem's #1.2. The passphrase cookie and the `API_SECRET` header are both static shared secrets with no rotation story and no rate limiting. Fine for one user who controls both ends; the first thing that has to change before this is ever shared with anyone else, even read-only.
- **A real two-way calendar sync**, not just create/read. Right now Google is written to and read from, but a change made directly in Google Calendar (someone reschedules a meeting you didn't reschedule from here) doesn't propagate back — `S2` in the architecture doc's spine has flagged this as open and lower-priority since v1.1, and it's stayed that way because the query tools read live from Google rather than a stale Supabase copy. Worth revisiting only if something starts depending on Supabase's own completion-status field specifically.
- ~~**The islands graph as a real query surface**~~ **Done Aug 9, at the library level.** `walk()`, `describeNeighbourhood()` and `resolveReference()` exist and are tested; "show me everything connected to this project" is now one call and returns 26 nodes for the real project on file. What is *not* built is a surface for it — a `/graph` page or a `query_connections` tool — and neither is `buildRichContext()` calling it. Those are the natural next steps and both are small now that the traversal exists.
- **Native app vs. PWA, revisited.** The premortem's #1.12 already covers this in depth: Web Push on iOS requires the PWA be installed to the home screen first, which is a real adoption tax even for an audience of one. Worth a fresh look now that the interface is fast and animated — is a home-screen PWA still the right shape, or does the lock-screen notification experience matter enough to justify a thin native wrapper?
- **Multi-tenancy**, if and only if this ever becomes something other than a single-user tool. Explicitly out of scope for now per your own call on Aug 7 — noted here only so it isn't silently re-proposed. If it comes back, the shape of the work is: a `user_id` column and RLS policy on every table, real auth, per-user OAuth and bank connections, and a rewrite of every cron job from "run once" to "run once per user." Weeks, not a session.

---

## Ideas that need a decision before they need code

- **Should insights be allowed to reference each other's findings**, or does that risk the model treating a chain of inferences as more certain than any single link in it? This is a real design tension, not just an implementation detail — the whole "compute facts in code, model only phrases" discipline gets harder to hold once one insight is built partly from another insight's output rather than raw data.
- **How much of the entity graph should be user-editable?** Right now a wrong edge can only be fixed by fixing the extraction logic and waiting for it to re-run, or clearing the underlying record. A UI for editing edges directly is a real feature, but it's also a second source of truth that the automatic extraction has to reconcile with.
- **Is the $10/month ceiling still the right constraint**, now that the feature surface is much larger than when that number was set? Worth a deliberate re-check against the OpenAI dashboard rather than an assumption either way.

---

## What's explicitly not on this list

The demo/landing page redesign, TypeUI, and Bklit were all raised and either shipped (the `/welcome` tour, the motion layer) or explicitly declined for now (TypeUI, Bklit — deferred as more effort than the ask warranted). Re-raise any of them if priorities change; they're not forgotten, just not queued.
