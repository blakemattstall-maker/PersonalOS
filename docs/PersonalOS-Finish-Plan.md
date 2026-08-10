# PersonalOS — The Plan to Finish

**Date:** 2026-08-09
**Purpose:** The end-to-end plan for taking PersonalOS from "works for one person" to "done." Written for a future Claude Code session to pick up cold and execute, and for Blake to make decisions against.

**Read first:** `PersonalOS-Knowledge-Architecture.md` (what the system knows), then `PersonalOS-Current-State-Handoff.md` (what is true right now).

---

## 0. Decisions made (2026-08-09)

| Question | Answer |
|---|---|
| Where does this end up? | **Single-user, made demonstrable.** Not multi-user — see the reversal below |
| Resume framing? | **Broad net.** Media/producing now, slightly-technical product later |
| Always-on computer? | **No** — a laptop that gets carried. Intermittent only |
| Is it a company? | **Untested, and to be tested with a landing page rather than with code** |

### The reversal, and why

The first version of this plan was written against "shareable with a few people." Blake reconsidered, and the reconsideration was correct. Recorded here so it isn't re-litigated:

**The middle option is the worst of the three.** It costs the full multi-tenancy price — real auth, `user_id` and RLS on 26 tables, per-user Google and bank connections, every cron rewritten to loop — and buys users who realistically log in twice. Personal-assistant apps have brutal retention even when polished and free. In exchange you take custody of other people's bank transactions and email.

**"Just me feels short" is a real feeling with the wrong remedy.** What makes it feel short is that nobody can see it. The cure is a demo account, a 90-second video and a case study — not a signup form. Three people watching a good demo is worth more than five friends with dormant accounts.

**The competitor fear is the least of the blockers.** Well-funded companies are building AI assistants and this will not out-feature them — but that is not what would kill it. What would kill it is structural and boring: Gmail is a *restricted* OAuth scope requiring a paid third-party security assessment for any public app; bank data means holding strangers' financial records; every user costs LLM spend against no revenue; and the builder is a final-year student in a job search.

That is oddly good news: **"is this a company" is a demand question, not an engineering one** — and demand can be tested for the price of an afternoon (§6), with zero multi-tenancy code. Build the evidence first. The door stays open; it just isn't paid for in advance.

Everything below follows from these four.

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

## 3. The road to multi-user — **deferred, kept for reference**

> ⚠️ **Not the current plan.** See §0. This section is retained because it is accurate and because it is what to execute *if* §6's demand test produces real signal. Do not start any of it before then.
>
> The two things worth carrying forward regardless of route: the **per-user cost cap** (§4C) is needed the moment a second person exists, and the **onboarding / cold-start** work (§4D) is valuable even for a single user, because a demo account has exactly the same empty-app problem.

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
| ~~A `/graph` page~~ ✅ | Built 2026-08-10. The best demo asset in the project — it makes the invisible thing visible | Done |
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

## 6. Demo account, `/graph`, and the cheap company test

### `/graph` — ✅ BUILT (2026-08-10), then REBUILT the same week as the force view

The radial one-neighbourhood-at-a-time version described below shipped and was replaced days later at the user's direction: the sell-factor feature is the fullscreen Obsidian-style force graph (library: `force-graph`, the 2D sibling of 3d-force-graph — rationale and rules in the Knowledge Architecture doc §3). Node size = degree, four family colours, tap-to-traverse, family filters, deep links still land centred. The radial view and its geometry module are gone; `phrasing.js` survived because sentences over edges are needed wherever edges are rendered.

### The first version, for the record

Shipped. Full design rationale lives in the Knowledge Architecture doc §3 ("Seeing the graph"); this section records what changed about the *plan* while building it.

**The plan said "pick a project or person, get everything attached." That was right. What the plan missed was that the graph was too thin to be worth a page.** Auditing the live data first turned up the real shape:

| | |
|---|---|
| Edges | 37 |
| One project's share of them | **65%** |
| Next-best-connected node | degree 3 |
| Transactions attached | 10 of 129 |
| Memories attached | **0 of 21** |

A viewer over that is a dandelion — strictly less impressive than the *fictional* net `/welcome` already animates, which would be an odd thing for the real page to be. So the page and a density pass shipped together:

- **Merchants and categories became entities** (`docs/schema-merchants.sql`). The point is not the charges hanging off a merchant; it is that the entity roster goes from twelve names to ~fifty, so a *note* mentioning a shop now reaches that shop's whole history.
- **Memories stay out of the graph, deliberately.** They are all statements about the user ("prefers walking over running") and name nothing, so only embedding similarity could attach them — and that is a guess the graph's own rule forbids. Decided, not deferred.

**Three bugs the build surfaced, all of which were live before it:**

1. `findMentions` matched the **first word** of any name. Fine for "Sam" → "Sam Smith"; catastrophic once merchants joined, where it hands "Quality Food Centers" the word *quality*. It was already wrong for places — the one real place on file is "Temporary internship home".
2. `graphAnchors` counted **edges** where the page draws **nodes**, so a project advertised 24 connections and drew 23.
3. The relation phrasing was shared between two opposite readings, so the caption claimed a merchant *mentions* a note when the note mentions the merchant — a true edge and a false sentence about it.

**It is not a tab.** Six is already the limit of that bar. It is entered from `ProjectCard`, `PersonCard`, and — the good one — `InsightCard`, which walks to the entity refs the detectors fired on. "Why are you telling me this" now has an answer.

Note `web/app/welcome/SceneGraph.js` still animates the fictional version for the tour. The real page shares its visual language on purpose — SVG, one moss highlight, a live caption pane — so the tour's promise is recognisable when it arrives.

**One manual step remains: paste `docs/schema-merchants.sql` into the Supabase SQL editor, then run the `connectIslands` cron once.** Until then the page works on the 37 existing edges and the schema probe reports the migration pending.

### Demo account ≠ the tour that already exists

These are two different things and conflating them cost a round of confusion:

| | What it is | Status |
|---|---|---|
| **`/welcome`** | The signed-out marketing tour. Animated, prerendered, reads no data by design | ✅ Built and good |
| **Demo account** | The actual dashboard, seeded, that a stranger can click — dismiss a card, switch a money range, open the graph | ❌ Does not exist |

Today a recruiter can read *about* it or take Blake's word. They cannot touch it. **It must be interactive** — a static screenshot adds nothing the tour doesn't already do.

Implementation notes:
- `web/app/fixtures.js` already holds ~80% of the seed data, including the insight cards added this session. The work is a public read-only session, not new content.
- Reuse the `POS_FIXTURES` path rather than inventing a second fake-data mechanism.
- **Read-only must be enforced server-side, not by hiding buttons.** A demo session that can write is an open door to the real database.
- Keep the orange "not real data" bar. It is honest and it costs nothing.
- Cold start applies here too — a demo account with no memories renders an empty, useless app. Seed a bio and memories, or the demo demonstrates nothing.

### The company test, for the price of an afternoon

**Do not build multi-tenancy to find out whether people want this.** Build a landing page with the demo video and a waitlist. 200 signups is a real signal and *then* the §3 work is justified. Six signups saves six sessions and a compliance headache.

This is the whole reason §3 is deferred rather than cancelled: the evidence that would justify it is cheap to gather, and gathering it first is strictly better than guessing.

---

## 7. Execution order

Each line is roughly one Claude Code session. **Steps 1–4 are the whole plan.** Everything after is conditional.

| # | Work | Why here |
|---|---|---|
| 1 | ~~**`/graph` page + demo account**~~ ✅ **DONE** | Both shipped 2026-08-10. `/graph` is the fullscreen force view with the 3D sphere toggle; the demo is the passphrase `demo` — fictional data, read-only, both enforced server-side. §6 |
| 2 | **Phase 3 engine, gated** | "That's up from last week" — what makes it feel like it is watching. Buildable now; the gate is a runtime check, not a delay |
| 3 | **Reliability pass** — *partially done* | Rate limiting + the TTS auth hole shipped 2026-08-10 (`lib/ratelimit.js`). Remaining: `resolveReference` into capture, the Action Button shortcut, and the runs-a-week-untouched check |
| 4 | **Case study + 90-second video** | The actual career asset. The highest-value item on this list and the one most likely to be skipped |
| 5 | *Landing page + waitlist* | Optional, an afternoon. The cheap answer to "is this a company" |
| — | *Multi-user (§3)* | **Only if step 5 produces real signal.** Not before |

**Definition of done for the job search: steps 1–4.** Four sessions. Multi-tenancy stays available and unbuilt until there is evidence it is worth six more.

### If usage or time is tight, in priority order

1. **The video** — recordable against the app as it exists today, with no further code. `/graph`, the sphere and the demo are all in it now.

Everything else is improvement rather than proof. (The demo account shipped — "click this" is live: the passphrase is `demo`.)

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
