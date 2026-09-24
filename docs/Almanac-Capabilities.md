# Almanac capability inventory

Current as of 2026-09-24. This lists what the running system can do today.

## Capture and routing

- Accept spoken audio or typed text from the iPhone Shortcut.
- Transcribe recordings on the server.
- Accept a copied URL or copied text with a capture. It uses the clipboard only when the spoken request refers to it.
- Route one request to several independent tools.
- Run dependent multi-step requests in order, so later steps can use earlier results.
- Ask a clarification when a task or event reference is ambiguous, then resume it on the next capture.
- Extract durable memories, projects, and reminders from a capture without replacing the requested answer.
- Return an answer to the Shortcut and send a web push when the interruption settings allow it.

## The 28 active voice tools

| Tool | What it does |
|---|---|
| `create_event` | Creates one-time or repeating Google Calendar events. |
| `create_task` | Creates Google Tasks with optional due dates. Repeating reminders become Calendar events. |
| `save_memory` | Saves durable facts about you, including preferences, habits, traits, and circumstances. |
| `query_schedule` | Reads your Calendar and answers schedule or availability questions. |
| `query_tasks` | Reads your open tasks and reports what is due, overdue, or upcoming. |
| `save_note` | Saves external facts, lists, addresses, codes, recommendations, or other reference material. |
| `query_notes` | Searches and answers from saved notes. |
| `start_deep_thinking` | Runs a longer structured analysis of a decision and saves the result to the dashboard. |
| `log_bodyweight` | Records a weigh-in. |
| `sync_canvas` | Pulls upcoming Canvas assignments into Google Tasks. |
| `save_intention` | Records something you want to do, try, read, build, or accomplish. |
| `query_projects` | Reports project status, next actions, materials, tasks, and schedule. |
| `modify_task` | Completes, reschedules, or deletes an existing task using ordinary words instead of an ID. |
| `modify_event` | Moves, reschedules, or cancels an existing Calendar event. |
| `query_finances` | Answers questions about balances, spending, merchants, categories, recurring costs, and affordability. |
| `query_health` | Answers from your full weight history, pace, goals, nutrition logs, and fitness context. |
| `general_question` | Answers personal or general questions using your profile, memories, current signals, and stored connections. |
| `query_connections` | Walks the knowledge graph to explain what is connected to a person, project, place, merchant, or vague reference. |
| `research_query` | Searches the live web, returns current information with sources, and saves the result as a note. |
| `save_person` | Creates or updates a person, relationship, birthday or important date, and check-in cadence. |
| `log_work` | Records work already completed at a job or internship for later resume, LinkedIn, and review use. |
| `query_work` | Summarizes work performed for an employer and can turn it into resume or LinkedIn material. |
| `query_people` | Answers questions about saved people, relationship details, and last contact. |
| `review_inbox` | Reads recent Gmail and identifies replies owed, commitments, and stated deadlines. It cannot send or delete mail. |
| `draft_email` | Creates a Gmail draft for review. It never sends it. |
| `export_to_doc` | Writes a structured Google Doc, optionally using live web research first. |
| `log_contact` | Records a call, message, visit, or other interaction and resets the person's check-in clock. |
| `run_chain` | Runs up to six dependent steps, such as research, then a document, then email drafts or tasks. |

The retired Jarvis desk, laptop-control, and food tools are excluded. Their code and stored data remain for reference, but they cannot be routed or run.

## Dashboard and app surfaces

- **Today:** morning brief, prompts, insights, nudges, deep analyses, active projects, search, and bulk clear.
- **History:** resolved prompts, insights, nudges, notes, and past activity.
- **Projects:** active and archived projects with tasks, events, materials, conversations, plan building, and status.
- **Career:** money and career-related spending. The internship feed and application pipeline are paused and hidden.
- **Money:** balances, account breakdown, categorized spending, merchants, recurring charges, transfers, and 7/30/90-day views.
- **Health:** weight history, current pace, target progress, and nutrition signals.
- **People:** relationships, contact history, birthdays and important dates, and check-in schedules.
- **Graph:** a searchable 2D or optional 3D map connecting people, projects, tasks, events, places, notes, spending, and other stored entities.
- **News:** real stories from published RSS feeds, ranked by relevance to your life and interests.
- **Practice:** adversarial debate sessions plus recorded pitch or teach-back exercises with transcription and feedback.
- **Settings and diagnostics:** notification level, Calendar coloring, Google connection, schema checks, and automation health. Settings show that internship monitoring is paused.
- **Demo mode:** a read-only version backed by fixtures instead of personal data.

## Automatic work

- Writes a morning brief before the notification window, then pushes it later if unread.
- Reviews intentions and turns worthwhile ones into scheduled nudges.
- Reconciles completed or deleted Google Tasks and Calendar events back into Almanac.
- Checks project deadlines and stale projects.
- Checks relationship follow-ups and maintains yearly important-date Calendar events.
- Imports bank transactions, categorizes spending, rebuilds the knowledge graph, and finds cross-domain insights.
- Rolls up daily metrics and looks for trends in money, health, projects, work, and follow-through.
- Fires time-based and Calendar-event-based reminders.
- Syncs Canvas assignments daily.
- Pulls and ranks current news each morning.
- Regenerates the personal profile from current evidence on its scheduled review cycle.
- Uses activity heartbeats and diagnostics so a stopped integration can be distinguished from a quiet day.

## External systems

| System | Access |
|---|---|
| Google Calendar | Read, create, reschedule, color, and delete Almanac-managed events. |
| Google Tasks | Read, create, complete, reschedule, delete, and reconcile tasks. |
| Gmail | Read recent mail and create drafts. No sending or deletion. |
| Google Docs/Drive | Create formatted documents in Almanac's Drive folder. |
| Canvas | Read an ICS assignment feed and mirror assignments into Tasks. |
| SimpleFIN | Read account balances and transactions. No money movement or trading. |
| OpenAI | Audio transcription, routing, reasoning, embeddings, web search, writing, and speech-related processing. |
| Supabase | Main database for personal data, projects, graph edges, activity, settings, and cached external data. |
| Vercel | Hosts the web app, API functions, and daily scheduled jobs. |
| GitHub Actions and Supabase cron | Ring reminder endpoints that Vercel's plan cannot schedule often enough. The internship schedules are paused. |
| NPR, BBC, WSJ Markets, and Ars Technica RSS | Supply the news feed. |
| Web Push | Delivers briefs, capture replies, reminders, and insights to the phone. |

## Paused and retired features

- **Internships are paused:** no board polling, listing enrichment, deadline reviews, weekly digest, phone alerts, Today feed messages, or scheduled liveness checks run. Existing postings and pipeline history are preserved.
- **Food is retired:** no menu fetches, dining sync, meal planning, food logging, or food routing runs. Existing food records are preserved.
- **Location is retired:** no phone GPS ingest, visit processing, place-based reminders, location metrics, or Calendar/visit linking runs. Existing historical points and places are preserved.

## Current size

- 365 version-controlled project files.
- 66,005 physical lines of code across JavaScript, SQL, CSS, Python, C/C++, and shell files.
- 49,473 nonblank code lines.
- 50,748 lines in the web application.
- 10,788 lines of automated tests.
- 3,340 lines of project documentation.
- 7.42 MiB of version-controlled files, excluding dependencies, build output, and Git history.
