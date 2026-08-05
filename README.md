# PersonalOS

A personal operating system. You talk to it; it reads and changes your real
calendar, tasks, notes, money and relationships, and it occasionally decides on
its own that something is worth telling you.

Single-user by design, running on free tiers, at roughly **$7/month all-in**.

---

## The shape of it

```
iPhone Shortcut ──voice──▶ /api/capture ──▶ router (LLM picks a tool)
                                             │
web dashboard  ──────────▶ /api/[resource]   ├──▶ ~20 tools ──▶ Supabase
   (Next.js, separate                        │                  Google Calendar
    Vercel project)                          │                  Google Tasks
                                             │                  SimpleFIN
Vercel Cron    ──────────▶ /api/cron/[job] ──┘                  OpenAI
Overland (GPS) ──────────▶ /api/ingest/[kind]
```

Two deployments:

| | What | Deploys |
|---|---|---|
| **root** | the API backend (Node, Vercel serverless) | automatically on push to `main` |
| **`web/`** | the dashboard (Next.js 16, separate Vercel project) | **manually** — `cd web && npx vercel --prod --yes` |

## Layout

| Path | What lives there |
|---|---|
| `api/` | HTTP entry points. Dynamic routes on purpose — Vercel Hobby caps a deployment at 12 serverless functions, and a `[param].js` file counts as one. **Don't add top-level files here; extend the existing dynamic routes.** |
| `lib/` | Shared infrastructure: the router, auth, the Supabase client, the model registry, rich-context assembly, diagnostics, schema probing. |
| `tools/` | One file per capability. A tool is a function the LLM can choose to call. |
| `web/` | The dashboard. Its own package.json, own Vercel project, own env vars. |
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
router with the real prompt (parsed out of `api/capture.js` so it can't drift)
and runs every phrase **4 times**, because a phrase that passes 3/4 is a
failing phrase.

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

## Where to look next

- `docs/PersonalOS-Current-State-Handoff.md` — what is true right now. **Start here.**
- `docs/PersonalOS-Architecture-Source-of-Truth.md` — why it is built this way.
- `docs/PersonalOS-Premortem.md` — every way this project can fail, what to do
  about each, and a rebuild brief in §3.
