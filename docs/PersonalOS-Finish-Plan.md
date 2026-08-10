# PersonalOS — The Plan to Finish

**Date:** 2026-08-09
**Purpose:** The end-to-end plan for taking PersonalOS from "works for one person" to "done." Written for a future Claude Code session to pick up cold and execute, and for Blake to make decisions against.

**Read first:** `PersonalOS-Knowledge-Architecture.md` (what the system knows), then `PersonalOS-Current-State-Handoff.md` (what is true right now).

---

## 0. Decisions already made (2026-08-09)

| Question | Answer |
|---|---|
| Where does this end up? | **Shareable with a few people** — 5–20 real accounts, not a public product |
| Resume framing? | **Broad net.** Media/producing now, slightly-technical product later |
| Always-on computer? | **No** — a laptop that gets carried. Intermittent only |

Everything below follows from those three.

---

## 1. The phases, in plain terms

Stripped of jargon: what each one actually does for the person using it.

### Done already

**Phase 0 — "the numbers are right."**
The app was telling itself you'd spent $2,156 when you'd spent $711, and a whole section of the daily brief had never once appeared because of a one-word typo nobody could see. Fixed. Everything the app says about money and projects is now true.

**Phase 1 — "the app can look things up sideways."**
It stored connections between things — this task belongs to that project, this charge was for that person — but nothing could *read* them. Now it can. Also: your location data (1,287 points sitting there doing nothing) became "you spent 51 hours at home and 14 hours somewhere you haven't named."

**Phase 2 — "it says one thing instead of three."**
When the app noticed three related problems, it sent three notifications. Now it notices they're the same story and sends one. And insights — things it figured out on its own — used to exist *only* as a notification, so if you swiped it away it was gone forever. Now they wait for you on the dashboard.

### Not built yet

**Phase 3 — "it notices things changing."**
Right now the app only knows what's true *today*. It can say "10 tasks overdue" but never "that's up from 3 last week." This is the difference between a dashboard and something that actually watches.

> **The gate, corrected.** I previously said this was blocked until mid-September. That was wrong, and it's worth being precise: the *engine* can be built now. What can't be shipped is *claims* — "you always", "that's up from" — until there's enough history to support them. That's a check the code makes at runtime, not a reason to delay writing it. The pattern already exists (`MIN_DAYS_FOR_TRENDS` in `tools/observer.js`): compute always, speak only when the data supports it. **Build the engine now, gated. Tune the thresholds in September when there's a distribution to look at.**

**Phase 4 — "other people can use it."**
Everything currently assumes one person. Every table, every scheduled job, every connection to Google and your bank. This is the expensive one. See §3.

---

## 2. What "done" means

Done is not "no more ideas." Done is these five things being true:

1. **It runs for a week without you touching it**, and if something breaks you find out from the app rather than by noticing silence.
2. **Someone else can use it** without you sitting next to them.
3. **You can demo it in 90 seconds** from your phone, cold, without apologising for anything.
4. **The cost is bounded** and you know what it is per user.
5. **The docs are good enough** that a stranger could pick it up.

Numbers 1, 3 and 5 are nearly true today. Number 4 is a small piece of work. Number 2 is §3.

---

## 3. The road to "a few people can use it"

**Be honest about what this costs.** This is weeks of work, and it is the only option that puts other people's bank transactions and email in your database. That is a liability shift, not just an engineering task. Everything before Phase 4C is reversible and useful regardless; Phase 4C is the point of no return.

### 4A. Auth that is actually auth *(1 session)*

Today: one shared passphrase in a cookie, one shared `API_SECRET` header. No accounts, no rotation, no rate limiting.

- Real sessions with per-user identity. Recommend **Supabase Auth** — already in the stack, free tier covers this, gives password + magic link + OAuth out of the box, and its JWTs are what RLS reads. Do not hand-roll this.
- Rate limiting on the login route.
- Keep `API_SECRET` for the Shortcut and cron — those are machine callers and shouldn't hold user sessions.

**Done when:** two accounts exist and each sees only their own dashboard.

### 4B. `user_id` everywhere *(1–2 sessions)*

Every one of the 26 tables gets a `user_id` column and a row-level-security policy. This is mechanical but unforgiving — **one missed table is a data leak between users.**

- Write the migration as one `.sql` file (Supabase DDL is still a manual paste — trap #1).
- **Add a test that fails if any table lacks `user_id`.** Same shape as `tests/substrate.test.js`'s migration-coverage test. This is the single most important test in this phase.
- The service key currently bypasses RLS. That's correct for one user and wrong for many — the seam is `lib/supabase.js`, and it's already documented as such.
- Every cron job becomes "run once per user." Watch the cost: `reviewIntentionsForNudges` is one model call **per open intention per user per day**. Ten users with ten intentions each is 100 calls a day. Needs a per-user cap before this ships.

**Done when:** a test proves no table is unscoped, and two accounts provably cannot see each other's rows.

### 4C. Per-user connections *(1–2 sessions, plus external friction)*

This is where the real blockers live, and they're not code:

**Google (Calendar/Tasks/Gmail/Docs).** Gmail read access is a *restricted* scope. An app in "production" publishing status needs Google's security assessment to use it — that's a paid third-party audit and weeks of process. **The path that works for 5–20 people:** leave the OAuth app in **Testing** status and add each person as a test user (the cap is around 100). Restricted scopes work for test users without verification. The catch, and tell people up front: refresh tokens for apps in testing mode expire roughly weekly, so users have to reconnect Google periodically. Annoying, survivable, and free. Verify the current expiry behaviour before promising anything.

**Banking (SimpleFIN).** Each person needs their own SimpleFIN account and token — $15/yr each, paid by them. Not something you can provide. Make it optional; the app should be fully useful without it.

**Cost per user.** LLM spend scales linearly. Before anyone else touches this, add a per-user daily call budget and a hard stop. You are currently self-monitoring on a dashboard, which does not survive a second user.

**Done when:** a second person connects their own Google account and gets a brief the next morning.

### 4D. Onboarding *(1 session)*

The single most valuable thing here is not a form. It's the **cold-start problem**: a brand-new account has no memories, no bio, no intentions, and every reasoning feature degrades to nothing. A new user's first impression is an empty, useless app.

- A short guided setup that writes real `memories` and a `profiles.bio` from the answers. The "facts-about-me confirmation pass" already sitting in the roadmap is exactly this — build it as onboarding rather than as a widget.
- Ask for the minimum: name, timezone, 3–5 things about themselves, one thing they've been meaning to do.
- Connect Google as step 2, and let them skip it.
- **A seeded demo account** (see §6) is the honest fallback for anyone who won't finish setup.

**Done when:** a new account goes from signup to a useful first brief without you helping.

---

## 4. Features you asked about — build, defer, or skip

### Reading your texts — **defer, and lower your expectations**

There is no API for iMessage. The only real options:

- **Local `chat.db` read on a Mac.** Requires Full Disk Access and a machine that's on. Your laptop is carried, so this is batch-only — it syncs when you happen to have it open. Doable, genuinely useful for relationship tracking (it would answer "when did I last actually talk to my mum" without you logging it), and completely dead as a realtime feature.
- **iOS Shortcuts automation** can fire on a received message but gives you very little content and is fragile.
- **Android/RCS/WhatsApp:** no.

**Verdict:** defer until after 4A–4D. If it happens, build it as a *push* from the laptop to `/api/ingest/messages` — never as the app pulling. And note it's single-user-only: you cannot ask other people to run a script that reads their messages.

### Better control over your devices — **skip most of it, one exception**

You already have the good version: the iOS Shortcut is device control. It captures voice, it can be a home-screen button, it can fire on automation triggers.

- **HomeKit / smart home:** skippable. Shortcuts already does this and the app has nothing to add — "turn off the lights" through PersonalOS is strictly worse than saying it to Siri.
- **The one exception: an "Ask PersonalOS" Shortcut** that hits `/api/capture` and speaks the answer back, bound to the Action Button. That's ~30 minutes and makes the app feel present in a way the dashboard never will.

**Verdict:** build the Action Button shortcut. Skip the rest.

### Hardware — **skip**

You said you'd consider a cheap always-on box. Don't buy one for this. Nothing in the plan above needs it: the crons run on Vercel, the data is in Supabase, and the only thing a local machine unlocks is message reading, which is deferred anyway. Revisit only if message reading becomes the killer feature.

### Other features worth their cost

| Feature | Why | Size |
|---|---|---|
| **`resolveReference` into capture** | Already built and tested; nothing calls it. "The thing with Priya" becomes answerable | Small |
| **A `/graph` page** | The best *demo* asset in the whole project — it makes the invisible thing visible. High resume value | Small–medium |
| **Merchant recategorisation** | One tap fixes a wrong category forever. Already scoped in the roadmap | Small |
| **Push action buttons** | "Done"/"Snooze" straight from the notification | Small |
| **Per-user cost caps** | Required before anyone else uses it | Small |

### Explicitly not worth it

Plaid migration, two-way calendar sync, a native app wrapper, real-money anything (permanently declined), and a public product with billing.

---

## 5. Resume, LinkedIn, and the portfolio

Target is broad: media/producing now, slightly-technical product later. The good news is one artifact serves both — **but the framing has to lead with judgment, not architecture.** Nobody hiring a producer cares about pgvector; everybody hiring anything cares that you shipped something real, alone, and made hard calls about what *not* to build.

### Resume — yes, one entry

Under **Projects**, not Experience. Three bullets. Lead with scope and constraint, not tech.

> **PersonalOS** — Personal operating system (solo build)
> - Designed and shipped a single-user AI assistant that reads and writes real calendar, task, email, banking and location data, and proactively surfaces cross-domain insights — 23 capabilities, 163 automated tests, running at ~$7/month.
> - Set and held a hard product constraint of one notification per day, which killed several built features; wrote the interruption budget into the architecture so it couldn't be violated later.
> - Audited my own system against production data and found three defects that had never surfaced to a user — including a figure reported 3× too high across every AI-generated summary — then rebuilt the data layer so the error class couldn't recur.

The third bullet is the strongest one you have and it is not a technical bullet. It's "I audit my own work and I know what silent failure looks like." That reads as product maturity to a PM interviewer and as rigour to anyone else.

### LinkedIn — yes, but the Featured section, not Projects

- Projects section is where things go to be ignored. Put it in **Featured** with a thumbnail.
- **The single highest-leverage asset is a 60–90 second screen recording.** Phone in hand, speak a sentence, show it file itself, show the morning brief, show one insight that connects two things. No narration about architecture. For media/producing roles this *is* the portfolio piece — it demonstrates the thing you're being hired to do.
- One post when you publish it. Lead with the thesis, not the tech: *"I logged 1,287 location points, 621 actions and three months of transactions to find out whether a computer could actually notice things about my life. Here's what it got right and what I had to delete."*
- Link the public repo. It's already PII-free by rule.

### The case study — do this before anything else in §5

A one-page write-up beats every bullet above. Structure it around decisions, not features:
- Why one notification a day, and what that cost.
- Why the model never does arithmetic.
- Why the auto-trading feature was built and then deleted.
- What the audit found and what it changed.

That page is what you send when someone says "tell me about something you built."

---

## 6. The checkpoint I'd actually stop at

Before committing to §3, consider stopping here — it is roughly two sessions instead of six, and for a recruiter-facing goal it is nearly indistinguishable:

**Demo mode.** A seeded, read-only account with realistic fake data (`web/app/fixtures.js` already has most of it), reachable at a public URL with no signup. Anyone can click it and see the whole thing working.

It gets you: a live link on your resume, a thing recruiters can poke at, zero liability, zero per-user cost, and no Google verification problem. It does not get you: real users, which matters only if the goal is a product rather than a portfolio piece.

**Recommendation:** build demo mode first regardless. It's a prerequisite for a good demo video, and if it turns out to be enough, you've saved four sessions.

---

## 7. Execution order

Each line is one Claude Code session.

| # | Work | Why here |
|---|---|---|
| 1 | **Demo mode + `/graph` page** | Fastest path to a demo-able artifact; §6 |
| 2 | **Phase 3 engine, gated** | Buildable now; the gate is a runtime check |
| 3 | **Per-user cost caps + `resolveReference` into capture + Action Button shortcut** | Small, high-value, prerequisites for anyone else using it |
| 4 | **4A — real auth** | ⚠️ Point of no return begins |
| 5 | **4B — `user_id` + RLS + the test** | The leak risk lives here |
| 6 | **4C — per-user Google/banking** | External friction, not code |
| 7 | **4D — onboarding** | Solves cold start |
| 8 | **Case study + demo video** | Can happen any time after 1 |

**Stop-and-reassess after 3.** By then you'll have a demo-able, trend-aware, cost-capped app and will know whether real users are worth four more sessions.

---

## 8. Standing rules for future sessions

Carried forward from the audit; they're what keeps this from rotting.

1. Compute in code, phrase with the model. Never the reverse.
2. One definition per figure, shared as a function — sharing a route is not sharing the arithmetic.
3. Never guess an edge.
4. A failed query must never look like a quiet week.
5. Every new guard ships with a test that fails when the guard stops covering something.
6. Passive data outweighs active ~3:1 — **connect what's already collected before adding a new collector.**
7. Silence is the default. A muted app kills every other feature.
8. Before shipping anything user-visible: `npm test`, `npx next build` from `web/`, and verify against the live database.

---

## 9. Open questions for whoever picks this up

- **Google's test-user token expiry** — verify the current behaviour before promising anyone a setup experience. It shapes all of 4C.
- **Per-user cost ceiling** — what's the actual number? Nothing can be sized until it's chosen.
- **Does demo mode make §3 unnecessary?** Revisit after execution step 1.
- **Message reading** — only worth reopening if relationship tracking becomes the feature Blake actually uses daily.
