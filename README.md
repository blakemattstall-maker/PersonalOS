# PersonalOS

A personal operating system. You talk to it; it reads and changes your real
calendar, tasks, notes, money and relationships, and it occasionally decides on
its own that something is worth telling you. Everything it stores becomes an
entity graph you can walk — the `/graph` page renders your whole life as an
Obsidian-style force view, with an optional spinning 3D sphere.

Single-user by design, running on free tiers, at roughly **$7/month all-in**.
There is a public read-only demo on fictional data: the passphrase is `demo`.

---

## The shape of it

```
iPhone Shortcut ──voice──▶ /api/capture ──▶ router (LLM picks a tool)
   (silent; the app         │                  │
    pushes the reply) ◀─────┘                  │
                                               │
web dashboard  ──────────▶ /api/[resource]     ├──▶ 23 tools ──▶ Supabase
   (Next.js, separate                          │                 Google Calendar/Tasks/Docs/Gmail
    Vercel project)                            │                 SimpleFIN (12h cache)
                                               │                 OpenAI
Vercel Cron    ──────────▶ /api/cron/[job] ────┘
Overland (GPS) ──────────▶ /api/ingest/[kind]
```

One deployment, and one forwarder:

| | What | Deploys |
|---|---|---|
| **`web/`** | everything — the dashboard, `lib/`, `tools/`, and every API route | `cd web && npx vercel --prod --yes` |
| **root** | a `vercel.json` that forwards `/api/*` to the app above, and nothing else | automatically on push to `main` |

The dashboard and the API used to be separate Vercel projects, so every page
load made a full HTTP round trip between them — six of them on the home page
alone. They are one deployment now and the dashboard calls the same handlers
in-process (`web/app/backend.js`), so that round trip is gone.

The root project still exists purely to keep its hostname alive. The iOS
Shortcut, Overland and the Google OAuth callback all point at
`personal-os-…vercel.app`, the Shortcut is hand-edited on a phone and is not in
version control, so those URLs must not change.

## Layout

| Path | What lives there |
|---|---|
| `web/app/api/` | HTTP entry points, as Next.js route handlers. Each one is a thin `route.js` wrapping an unchanged Node-style `handler.js` through the adapter in `_node.js` — see the comment there for why the handlers were not rewritten. |
| `web/lib/` | Shared infrastructure: the router, auth, the Supabase client, the model registry, rich-context assembly, diagnostics, schema probing. |
| `web/tools/` | One file per capability. A tool is a function the LLM can choose to call. |
| `web/` | The dashboard. Its own package.json, own Vercel project, own env vars. Design system lives in `web/app/globals.css` (tokens) and `web/app/ui.js` (shape vocabulary) — read the comment at the top of each before restyling anything. Motion goes through `web/app/motion.js`, never anime.js directly. |
| `web/app/welcome/` | The signed-out tour — where the passphrase gate now sends anyone without a session. Prerendered, reads nothing, and must stay that way. |
| `docs/` | Architecture, current state, the pre-mortem, and the `.sql` migrations. |
| `tests/` | Fast offline suite (`npm test`) plus the routing eval (`npm run test:routing`). |
| `dev/` | One-off scripts. Not tests — they print and exit. |

## Running it

```bash
npm test
```

Fast, offline, no API keys needed. Run this on every change.

```bash
npm run test:routing
```

The routing eval. Costs money and needs `OPENAI_API_KEY` — it calls the real
router with the real prompt (parsed out of the capture handler so it can't drift)
and runs every phrase **4 times**, because a phrase that passes 3/4 is a
failing phrase.

### Looking at the dashboard locally

`web/` holds `BACKEND_KEY` server-side and the backend's `API_SECRET` is live,
so a plain `next dev` can't fetch anything — every page renders its empty
state. The `web-preview` entry in `.claude/launch.json` starts it on port 3011
with a throwaway passphrase and `POS_FIXTURES=1`, which serves a realistic
dashboard from `web/app/fixtures.js` instead. It paints an orange bar across
the top so fixture data can't be mistaken for real data, and the flag is set
nowhere else — not `.env.local`, not Vercel. Covers the brief, prompts,
nudges, projects, `/api/finance` (any `days`) and `/api/settings` — money and
settings are otherwise unreviewable locally, since both hit real Supabase.
POSTs (a settings save, the money-page ask box) aren't fixture-gated and will
hit the real backend, which degrades gracefully to a failed save rather than
crashing — expect a toggle to visibly revert after saving locally, which is
this and not a bug.

If the app looks stuck on stale content after editing `sw.js` or anything
under `public/`, the service worker is caching it — `next dev`'s Fast Refresh
does not know how to bust that. Unregister it from the browser's devtools
(Application → Service Workers) rather than chasing a ghost.

```bash
node --env-file=.env.local -e 'import("./lib/schema.js").then(async m => console.log((await m.checkMigrations()).verdict))'
```

Which database migrations are actually live. Also shown on `/settings`.

## The things that will bite you

Read `docs/PersonalOS-Current-State-Handoff.md` before writing anything. The
short version:

1. **Supabase DDL cannot be run from code.** PostgREST reads and writes rows;
   it cannot create tables. Every schema change is a `.sql` file in `docs/` that
   a human pastes into the Supabase dashboard. `lib/schema.js` tells you which
   ones have actually been applied — and whether they're doing anything.
2. **No public URL may change.** The iOS Shortcut is hand-edited on a phone and
   is not in version control.
3. **Google Tasks stores a DATE, returned as UTC midnight.** Compare due-dates
   as `yyyy-MM-dd` strings, never as instants. Covered by `tests/traps.test.js`.
4. **Never let a model do arithmetic and then narrate it.** Compute in code,
   hand the model the figure as fact.
5. **A client-side timeout does not mean the server-side write failed.** Check
   actual state before retrying, or the retry becomes the bug.
6. **Auth is dormant when its secret is unset**, deliberately, so the Shortcut
   and the server can switch over independently. It is loud in the logs about
   it. Never let an unset secret be satisfiable by a guessable value.
7. **The capture Shortcut is silent.** Its notification used to be the only
   confirmation; the app now pushes the reply instead, so `/api/capture` must
   notify on *every* exit path — including questions and failures. A path that
   returns without notifying is a capture that appears to have vanished.
   `tests/capture-notify.test.js` fails if any tool would capture silently.
8. **Never store a relative date.** "tomorrow" written into a note or intention
   is read back days later by something with no idea when it was written, and it
   will repeat the word. This caused a notification announcing an internship
   ending "tomorrow" the morning after it ended, in two separate features.
   `lib/resolveDates.js` pins them at capture; use it on anything user-written
   that gets stored.
9. **Classify every push in `URGENCY_TIERS`** (`lib/settings.js`). An urgency
   the dial doesn't recognise is silently undeliverable at most settings —
   which is exactly how nudges went unpushable for a week without anyone
   noticing.
10. **Never hide content for an animation without all three escape hatches.**
    `.pos-reveal` starts at `opacity: 0` and JavaScript un-hides it, so reduced
    motion, no scripting, and no `IntersectionObserver` each need their own
    override — a media query, the `<noscript>` style in `app/layout.js`, and a
    feature check in `app/motion.js`. Miss one and the app renders as a blank
    page with no error anywhere. `tests/welcome.test.js` guards the first two.
11. **The gate's redirect target must be outside the gate's own matcher.**
    `/welcome` is excluded in `proxy.js`. If it weren't, every visitor without a
    cookie would be redirected to a page that redirects them back — and the
    symptom is a spinning browser on the one URL this app gets shared as.
12. **An entrance animation must hide via a static CSS class, never only via a
    JS effect keyed on a later condition.** `welcome/Hero.js`'s title rendered
    at full opacity for one real paint because it hid itself inside a
    `useEffect` gated on `ready`, instead of the `.pos-reveal` class every
    other animated element carries from the first byte of HTML. The fix was
    giving it that same class; the lesson is that "the effect will hide it
    before anyone notices" is never true — there is always a frame.
12b. **Never remove or replace a DOM node React rendered.** React holds a
    fiber pointing at it, and the next reconciliation of that subtree operates
    on a node that is no longer there and throws. The root layout reconciles on
    every `router.refresh()`, so nearly every server action triggers it. With no
    `error.js` anywhere in this app that surfaces as Next's built-in "This page
    couldn't load" on navigation and on most buttons, and a full reload always
    appears to fix it. This shipped once, from `el.remove()` on the boot splash.
    Add a class instead: React only patches `className` when the value it
    rendered changes, so a class added from outside survives every re-render.
    Guarded by `tests/welcome.test.js`.
12c. **Never give an `IntersectionObserver` a fractional `threshold`.**
    `intersectionRatio` is measured against the *element*, not the viewport, so
    an element taller than `viewport / threshold` can never reach the ratio no
    matter how far it is scrolled — the callback simply never fires. At 0.15
    that is anything over ~4,400px, which is one long list. The symptom is a
    tall permanently blank gap, not a slow animation. Use `threshold: 0` and let
    a `rootMargin` bottom inset decide how eager the trigger is; that is correct
    for an element of any height. Guarded by `tests/welcome.test.js`.
12d. **Rounding matters once a component that does trigonometry becomes
    `"use client"`.** `Math.cos`/`Math.sin` are not required to be correctly
    rounded, and Node and the browser disagree in the last bits, so an SVG path
    built from them hydrates with a mismatch on every single element. Round
    coordinates (`toFixed(3)` is plenty) so both sides produce the same string.
13. **`readPrefs().displayName` (or anything else read from `localStorage`
    that must differ from what the server rendered) belongs behind
    `useSyncExternalStore`, not a `useState` + `useEffect` pair.** The latter
    trips `react-hooks/set-state-in-effect` and costs an extra render; the
    former's third argument is exactly "what to render before hydration",
    which is the actual problem being solved. See `DeepThoughtThread.js`'s
    `selfName`.
14. **Removing the HTTP hop removed a JSON serialisation nothing knew it
    depended on.** `res.json()` used to flatten everything on the way out — a
    `Date` became an ISO string, an `undefined` key vanished. Calling the
    handler in-process hands the page the live object graph instead, and a
    `Date` rendered as a React child throws "Objects are not valid as a React
    child": with no `error.js` anywhere, the whole page becomes "This page
    couldn't load". This is how the money page died — `lib/simplefin.js` returns
    `date` as a real `Date`, and the finance handler's `recent` list passed it
    straight through. It had rendered a raw ISO string for as long as the hop
    existed, so it looked cosmetic right up to the moment it wasn't.
    `app/backend.js` now round-trips every payload through JSON, so the
    in-process path is provably identical to the HTTP one rather than intended
    to be. Guarded by `tests/money-page.test.js`.
15. **A path under `/api/` that is not `/api/[resource]/` needs its own entry in
    `app/backend.js`.** `parsePath` only ever produced a `resource`, so
    `backendPost("/api/ingest/push")` asked the `[resource]` handler for a
    resource named "ingest" and got `{"error":"Unknown resource: ingest"}` every
    single time — no push subscription was ever stored. The HTTP route worked
    throughout, which is why the consolidation didn't notice, and `PushSetup.js`
    discarded the result, so Settings cheerfully reported "On". Two lessons, and
    the second is the bigger one: **a server action whose result is thrown away
    cannot fail.** If a write matters, check what it returned.
16. **SimpleFIN's `errors` array is not only errors.** It also carries
    advisories about the shape of *your own request* — any window over 45 days is
    commented on, every call — and those were being reported to the user as bank
    connection problems and fed to the finance model, which made the one warning
    that matters (a bank needing re-auth) indistinguishable from permanent
    noise. `realWarnings()` in `lib/simplefin.js` filters them, on read as well
    as on write, and logs them so a genuine future cap is still visible.
17. **Two summarisers over the same transactions will drift, and sharing a route
    does not stop them.** `tools/finances.js` had its own totals that had never
    heard of the `transfers` category, so the ask box at the bottom of the money
    page answered "$2,159.91 spent" about the same 30 days the chart above it
    labelled "$714.98". Both were deliberately served by one route so they
    couldn't disagree. Sharing an entry point is not sharing the arithmetic —
    share the function.
17b. **…and it had already happened twice more, in the two places with the
    widest blast radius.** `lib/signals.js` and `tools/metrics.js` each totalled
    every negative row. Signals rides inside `buildRichContext()` into ten
    reasoning tools, so every judgment this app made about money was made
    against $2,156 for a month the page called $711; `daily_metrics` is the
    longitudinal record, so it was writing a row of history a day against a
    definition nothing else used. `lib/money.js` is now the only place a money
    figure comes from and `tests/substrate.test.js` fails if anything reaches
    past it to `getFinancialData`. **The fix for a drift is not fixing the
    number — it is deleting the second place the number can be computed.**
18. **A determination that changes a total is never a model's to make.** The
    merchant classifier could answer `transfers`, and on live data it called
    Tagadapay.com — a payment processor — a transfer, silently removing $188.44
    of real purchases from the 90-day spend figure. The classifier is also not
    reproducible, so the same window could report two different totals on two
    cold containers with nothing to point at. `MODEL_CATEGORIES` now withholds
    `transfers` and `income` (both decided by rule), so a model's answer can
    move a merchant between categories but can never move `spent`. Measured:
    totals are now identical run to run.
19. **A function that returns the same value for "nothing to report" and "the
    query failed" will eventually be broken and silent.** `projectSignal`
    selected `projects.title`; the column is `name`. It errored on every run
    from the day it was written, `if (error || !data) return null` swallowed it,
    and the Projects line never once appeared in a brief, an observation or a
    nudge evaluation. Nothing said so. Every signal now logs a query failure
    loudly and distinguishably — the null return stays, because one broken
    signal must not take down a brief.
20. **A guard that doesn't cover what it protects is worse than no guard,
    because it is believed.** `lib/schema.js` exists so nobody has to trust a
    document about which SQL has been run. It listed 8 of the 10
    `docs/schema-*.sql` files — the two it missed were the entity graph and
    nudge scheduling — and truthfully printed "All migrations applied and
    active" having never looked at the layer the whole cross-domain feature set
    depends on. `tests/substrate.test.js` now fails if a migration file has no
    entry.
21. **PostgREST caps a response at 1000 rows and `.limit()` does not raise it.**
    It lowers a ceiling that is already lower. So a query asking for 5,000 rows
    returns 1,000, with no error and no truncation flag. `visitsInWindow`
    shipped with exactly this and reported three visits across a fortnight
    because it had only ever seen one day of points; `shouldCreatePlace` and the
    orphan-adoption pass had it already, so a newly recognised place could be
    created already missing the visits that created it. Use `selectAll()` in
    `lib/supabase.js` for anything that scans a table. `tests/graph.test.js`
    rejects any `.limit()` above the cap.
22. **A data structure with no read path is not built, however correct its
    writes are.** `entity_links` was written nightly for weeks while
    `neighbours()` had exactly two callers, both inside one detector — no tool,
    query, page or context assembly could ask the graph anything. It was a real
    graph and an unreadable one, and nothing about it looked broken. Ship the
    reader with the writer.
23. **`app/backend.js` turns a handler that threw into `{ error }` with no
    `success` key**, so a caller testing only `result.success === false` reads
    a 500 as a success. `InsightCard` checks both shapes. This is trap #15's
    sibling: there, a discarded result could not fail; here, a checked result
    fails in a shape the check didn't cover. Whenever a write matters, check
    what it returned **and** know every shape "it went wrong" can arrive in.
24. **There is no `error.js` anywhere in this app, so a throw out of a server
    action replaces the entire page** with Next's "This page couldn't load".
    `resolveInsight` therefore returns `{ success: false, error }` instead of
    throwing — a button that clears one card must not be able to take down the
    dashboard. Note the other half: an update that matched **zero rows** is
    reported by PostgREST as an empty array and no error, so "did nothing" has
    to be checked for separately or a stale id looks like a success.
25. **A Google OAuth app left in "Testing" issues refresh tokens that die after
    exactly seven days.** Nothing in this repo is wrong when it happens: one
    week after the last consent, every Google call — brief sources, tasks,
    calendar, Gmail, Docs — starts failing with `invalid_grant` on the same
    morning. `lib/google.js` proves the token before handing out a client, so
    it fails once, in one place, with words a person can act on; it pushes at
    most one "reconnect" notification a day; Settings → Diagnostics probes the
    token live and carries the reconnect button. The cure is Cloud Console →
    OAuth consent screen → **Publish app**: production tokens don't expire (an
    unverified app is capped at 100 users, which is 99 more than this one has).
    Until that's done, expect a weekly reconnect. `tests/google-auth-expiry.test.js`
    pins the detection and the alert's claim-before-push order.
26. **A "Sensitive" Vercel env var cannot be read back, so a wrong one hides
    indefinitely.** `GOOGLE_REDIRECT_URI` was migrated into production still
    pointing at `localhost:3000` and marked Sensitive — the phone's reconnect
    flow bounced to a dev server that wasn't there, and no dashboard surface
    could display the value that did it. The OAuth handler now derives the
    redirect URI from the requesting host (`redirectUriFor` — the env var only
    wins when its locality matches the request's), so every host registered on
    the Google client works and local dev stays local. Each new production
    host still needs adding to the OAuth client's Authorized redirect URIs in
    Cloud Console. `tests/oauth-callback.test.js` pins the derivation.

## Where to look next

- `docs/PersonalOS-Knowledge-Architecture.md` — **what the system knows, how it
  connects, and what it is allowed to conclude.** This is the product; read it
  before changing anything that touches memory, the graph, signals or insights.
- `docs/PersonalOS-Current-State-Handoff.md` — what is true right now. **Start here.**
- `docs/PersonalOS-Architecture-Source-of-Truth.md` — why it is built this way.
  Carries a correction notice: it is the document most prone to going stale.
- `docs/PersonalOS-Intelligence-Audit-2026-08-08.md` — *historical* — the audit
  that produced traps 17b–22 above; its plan has since been executed.
- `docs/PersonalOS-Premortem.md` — every way this project can fail, what to do
  about each, and a rebuild brief in §3.
- `docs/PersonalOS-Finish-Plan.md` — **the plan to finish**: what "done" means,
  the road to multi-user, which features are worth building, and how to present
  this on a resume. Start here for anything forward-looking.
- `docs/PersonalOS-Roadmap-2026-08-08.md` — *historical* — superseded by the
  Finish Plan above.
