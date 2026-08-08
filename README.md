# PersonalOS

A personal operating system. You talk to it; it reads and changes your real
calendar, tasks, notes, money and relationships, and it occasionally decides on
its own that something is worth telling you.

Single-user by design, running on free tiers, at roughly **$7/month all-in**.

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

## Where to look next

- `docs/PersonalOS-Current-State-Handoff.md` — what is true right now. **Start here.**
- `docs/PersonalOS-Architecture-Source-of-Truth.md` — why it is built this way.
- `docs/PersonalOS-Premortem.md` — every way this project can fail, what to do
  about each, and a rebuild brief in §3.
- `docs/PersonalOS-Roadmap-2026-08-08.md` — what to build next, sized small to
  big, for picking up a long session cold.
