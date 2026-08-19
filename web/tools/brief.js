import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import { MODELS } from "../lib/models.js";
import { buildRichContext } from "../lib/context.js";
import { getUserTimezone } from "../lib/profile.js";
import { getEvents } from "./googleCalendar.js";
import { getTasks, taskDueDate } from "./googleTasks.js";
import { analyseDay } from "../lib/eventKind.js";
import { getAllPeople } from "./people.js";
import { getOpenIntentions, getProjectsWithDetails, getRecentBriefs } from "./database.js";


// The morning brief.
//
// It used to be two tool outputs glued together:
//
//     `Schedule: ${schedule.message}\n\nTasks: ${tasks.message}`
//
// which is a list of events and a list of to-dos with nothing joining them.
// It could not say which of nine calendar entries mattered, could not tell a
// meeting from an hour set aside to do laundry, and had no idea that money,
// a person going quiet, or an unanswered email existed at all. Every domain
// this system collects was invisible to the one thing read every morning.
//
// This composes instead. The shape of the day is computed in code — hours
// committed, overlaps, what kind of thing each entry is, what is genuinely
// overdue — and the model is handed those as settled facts and asked only to
// decide what matters and say it well. That division is deliberate and is trap
// #4: a model that does its own arithmetic will occasionally be wrong and
// always sound certain.


function overdueTasks(tasks, todayISO) {

  return (tasks || [])
    .filter(t => t.due)
    // Google Tasks stores a DATE returned as UTC midnight — compare as
    // yyyy-MM-dd strings, never as instants. Trap #1.
    .filter(t => taskDueDate(t.due).toFormat("yyyy-MM-dd") < todayISO)
    .map(t => ({ title: t.title, due: taskDueDate(t.due).toFormat("yyyy-MM-dd") }));

}


function dueToday(tasks, todayISO) {

  return (tasks || [])
    .filter(t => t.due && taskDueDate(t.due).toFormat("yyyy-MM-dd") === todayISO)
    .map(t => t.title);

}


// People the app already believes are overdue, computed from the cadence he set
// rather than inferred from tone.
function peopleGoneQuiet(people, now) {

  return (people || [])
    .filter(p => p.check_in_days && p.last_contacted_at)
    .map(p => ({
      name: p.name,
      days: Math.floor(now.diff(DateTime.fromISO(p.last_contacted_at), "days").days),
      cadence: p.check_in_days
    }))
    .filter(p => p.days > p.cadence)
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);

}


function importantDatesSoon(people, now) {

  const out = [];

  for (const person of people || []) {

    if (!person.important_date_month || !person.important_date_day) continue;

    let date = DateTime.fromObject(
      { year: now.year, month: person.important_date_month, day: person.important_date_day },
      { zone: now.zone }
    );

    if (!date.isValid) continue;

    if (date < now.startOf("day")) date = date.plus({ years: 1 });

    const days = Math.round(date.diff(now.startOf("day"), "days").days);

    if (days <= 14) {
      out.push({ name: person.name, label: person.important_date_label || "important date", inDays: days });
    }

  }

  return out.sort((a, b) => a.inDays - b.inDays);

}


// Everything the brief is allowed to talk about, gathered as facts. Each source
// degrades on its own — a brief missing the money line is still a brief, but a
// brief that fails to render because Gmail was slow is not.
export async function gatherBriefFacts({ tz } = {}) {

  const zone = tz || await getUserTimezone();

  const now = DateTime.now().setZone(zone);

  const todayISO = now.toFormat("yyyy-MM-dd");

  // A failed source is named and remembered, not swallowed. The old version
  // caught every failure into an empty fallback with no log — so a slow Google
  // token turned into "CALENDAR: nothing scheduled" and "OPEN TASKS: 0", stated
  // as fact, on a day that actually had three meetings. A wrong brief the model
  // then writes prose on top of is worse than a brief that admits it couldn't
  // reach the calendar.
  const failed = new Set();

  // "Unavailable" alone is the symptom; when the cause is the one he can fix
  // in twenty seconds — the Google token died, so calendar, tasks AND inbox
  // are all down together — the brief should say the cause and the fix, not
  // three separate shrugs.
  let googleAuthExpired = false;

  const settle = (name, promise, fallback) => promise.then(v => v).catch(error => {
    if (error?.code === "GOOGLE_AUTH_EXPIRED") googleAuthExpired = true;
    console.error(`BRIEF source "${name}" unavailable — rendering it as unknown, not as a false zero:`, error?.message);
    failed.add(name);
    return fallback;
  });

  const [events, tasks, context, people, intentions, projects, inbox, priorBriefs] = await Promise.all([
    settle("calendar", getEvents({ startDate: todayISO, endDate: todayISO, maxResults: 50 }), { events: [] }),
    settle("tasks", getTasks({ maxResults: 100 }), { tasks: [] }),
    settle("context", buildRichContext(), {}),
    settle("people", getAllPeople(), []),
    settle("intentions", getOpenIntentions(), []),
    settle("projects", getProjectsWithDetails({ status: "active" }), []),
    // Only reachable once the readonly scope is granted; a brief without it is
    // still a brief.
    settle("inbox",
      import("./gmail.js").then(m => m.reviewInbox({ days: 3, limit: 25 })),
      { success: false }
    ),
    // Its own memory. The composer is told what the last few briefs said so
    // that a critique made on Monday is not rediscovered fresh on Tuesday,
    // Wednesday and Thursday.
    settle("priorBriefs", getRecentBriefs({ limit: 3 }), [])
  ]);

  const dayEvents = events.events || [];

  return {

    now,
    todayISO,
    zone,

    events: dayEvents,
    day: analyseDay(dayEvents),

    // "Couldn't fetch" is not "nothing there". renderFacts uses these to say so
    // rather than asserting an empty day the system never actually saw.
    calendarUnavailable: failed.has("calendar"),
    tasksUnavailable: failed.has("tasks"),
    googleAuthExpired,

    overdue: overdueTasks(tasks.tasks, todayISO),
    dueToday: dueToday(tasks.tasks, todayISO),
    openTaskCount: (tasks.tasks || []).length,

    quiet: peopleGoneQuiet(people, now),
    dates: importantDatesSoon(people, now),

    intentions: (intentions || []).map(i => i.content),
    projects: (projects || []).map(p => ({ name: p.name, next: p.next_action })),

    inbox: inbox?.success ? (inbox.data?.needs_you || []) : null,

    priorBriefs: priorBriefs || [],

    bio: context.bio || null,
    insights: context.insights || null,
    signals: context.signals || null,
    bodyweightTrend: context.bodyweightTrend || null

  };

}


function renderFacts(f) {

  const time = (iso) => iso ? DateTime.fromISO(iso).setZone(f.zone).toFormat("h:mma").toLowerCase() : "";

  const lines = [];

  lines.push(`TODAY: ${f.now.toFormat("cccc, d LLLL yyyy")}`);

  if (f.googleAuthExpired) {
    lines.push(
      "SYSTEM (lead with this, one blunt sentence): The Google connection has expired, " +
      "so calendar, tasks and inbox are all unreachable until he reconnects — " +
      "Settings, Reconnect Google, about twenty seconds. Do not guess at what the day holds."
    );
  }

  if (f.calendarUnavailable) {
    lines.push("CALENDAR: unavailable — the calendar could not be reached. Do NOT say the day is free; you do not know what is on it.");
  } else if (f.events.length === 0) {
    lines.push("CALENDAR: nothing scheduled.");
  } else {

    lines.push(`CALENDAR (${f.day.committedHours}h committed across ${f.events.length}):`);

    // Consecutive commitments arrive as one unit. A stretch of three classes
    // is rendered as a single block with its members named in parentheses, so
    // the model cannot narrate them one by one — the adjacency has already
    // been decided as fact, the same way the arithmetic has.
    for (const stretch of f.day.stretches) {

      if (stretch.events.length === 1) {
        const e = stretch.events[0];
        const who = e.attendees?.length ? ` with ${e.attendees.join(", ")}` : "";
        lines.push(`  [${e.kind}] ${time(e.start)}-${time(e.end)} ${e.title}${who}${e.location ? ` @ ${e.location}` : ""}`);
        continue;
      }

      const kinds = [...new Set(stretch.events.map(e => e.kind))];

      const label = kinds.length === 1 && kinds[0] === "class"
        ? `${stretch.events.length} classes back-to-back`
        : `${stretch.events.length} back-to-back`;

      lines.push(
        `  [BLOCK — one unit, do not enumerate] ${time(stretch.start)}-${time(stretch.end)} ` +
        `${label} (${stretch.events.map(e => e.title).join(", ")})`
      );

    }

    // All-day entries mark the day rather than occupying it; stretches only
    // cover timed events, so these still need their own lines.
    for (const e of f.events.filter(e => e.allDay)) {
      lines.push(`  [${e.kind}] all day ${e.title}`);
    }

    // A collision between two recurring fixtures is a standing fact of the
    // semester; only collisions with something movable in them are today's
    // news. The standing ones are withheld entirely — the reader has a
    // registration portal for those.
    const newOverlaps = f.day.overlaps.filter(o => !o.standing);

    if (newOverlaps.length) {
      lines.push(`  OVERLAPS (already checked; mention only if one side can actually move today): ${newOverlaps.map(o => `"${o.first}" runs into "${o.second}"`).join("; ")}`);
    }

  }

  if (f.tasksUnavailable) {
    lines.push("TASKS: unavailable — could not be reached, so overdue and due-today are unknown. Do NOT say there is nothing due.");
  } else {
    if (f.overdue.length) {
      lines.push(`OVERDUE (${f.overdue.length}): ${f.overdue.map(t => `${t.title} (due ${t.due})`).join("; ")}`);
    }

    if (f.dueToday.length) lines.push(`DUE TODAY: ${f.dueToday.join("; ")}`);

    lines.push(`OPEN TASKS: ${f.openTaskCount}`);
  }

  if (f.dates.length) {
    lines.push(`DATES COMING: ${f.dates.map(d => `${d.name}'s ${d.label} in ${d.inDays} day(s)`).join("; ")}`);
  }

  if (f.quiet.length) {
    lines.push(`GONE QUIET: ${f.quiet.map(p => `${p.name} — ${p.days}d since contact, wanted every ${p.cadence}d`).join("; ")}`);
  }

  if (f.inbox?.length) {

    // Second line of defence behind the classifier in gmail.js: anything that
    // still looks like machine mail is tagged so the composer can weigh it as
    // wallpaper rather than as a person waiting. Security-alert emails led the
    // brief four days out of seven before this existed.
    const automated = /security alert|vulnerab|sign.?in|new device|new ip|data access|verify|password|suspicious/i;

    lines.push(`INBOX (context, not the story): ${f.inbox.map(i =>
      `${i.subject} (from ${i.from}${i.deadline ? `, states ${i.deadline}` : ""})${automated.test(`${i.subject} ${i.from}`) ? " [automated — FYI at most]" : ""}`
    ).join("; ")}`);

  }

  if (f.projects.length) {
    lines.push(`PROJECTS: ${f.projects.map(p => `${p.name}${p.next ? ` — next: ${p.next}` : ""}`).join("; ")}`);
  }

  if (f.intentions.length) lines.push(`STANDING INTENTIONS: ${f.intentions.join("; ")}`);

  if (f.insights) lines.push(`NOTICED BY CONNECTING DOMAINS (already verified, state plainly):\n${f.insights}`);

  if (f.signals) lines.push(`CROSS-DOMAIN SIGNALS (already calculated):\n${f.signals}`);

  if (f.bodyweightTrend) lines.push(`BODYWEIGHT:\n${f.bodyweightTrend}`);

  return lines.join("\n");

}


export async function composeBrief({ tz } = {}) {

  const facts = await gatherBriefFacts({ tz });

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [

      {
        role: "system",
        content: `
You write one person's morning brief. You are not a summariser and you are not
an assistant reading a list back to them — you are a chief of staff who has
already read everything, decided what actually matters today, and is telling
him the two or three things worth his attention.

Voice: blunt, specific, no hedging, no cheerleading. He has explicitly asked
never to have things softened, and never to be congratulated for existing. Do
not open with a greeting, do not use his name, do not say "here's your brief".
Start with the single most consequential thing about today.

Hard rules:
- Every figure below is already calculated. Use them as given. Do NOT do
  arithmetic of your own and do not recompute times, totals or day counts.
- Do not list the calendar back in order. Anyone can read a calendar. A
  back-to-back stretch is handed to you as ONE unit — say "classes till 12:10",
  never three sentences. Name an individual entry inside a stretch only when it
  needs something special today: something due, something to bring, someone to
  talk to. Say what the shape of the day is, what will actually be hard about
  it, and what is worth protecting or moving.
- Email is context, not the story. Automated mail — security alerts,
  vulnerability notices, sign-in warnings, bank or data notifications,
  receipts — is never the lead and rarely worth a sentence. Only a named human
  waiting on him, or a stated deadline with real consequences, can put email at
  the top of a brief.
- You also wrote the previous briefs, quoted below the facts. Never repeat an
  observation, warning or critique from them unless the underlying number or
  state has materially changed — he already read it. A standing pattern
  (spending, weight) earns at most one mention a week, and only with a new
  figure. Finding what is NEW about today is the entire job.
- Distinguish what kind of thing each entry is. A class, a meeting with other
  people, an appointment, an hour he set aside for himself and a bare reminder
  are not the same and must not be described as if they were.
- Only mention money, relationships, projects or email when there is something
  genuinely worth saying. Silence on a domain is correct and expected.
- If two things collide and one of them can actually move, say so plainly and
  say which one should move. A standing collision between fixtures is not news.
- End with one sentence that is not an obligation: the best use of today's
  slack — a free window worth spending deliberately, something he queued and
  actually wants to do, a prep that would quietly pay off soon. Skip it only if
  the day genuinely has no room.
- No markdown, no headings, no bullet characters. Flowing prose in short
  paragraphs, the way a sharp person would actually tell you.
- Three short paragraphs at most. Being complete is worth less than being read.
`
      },

      {
        role: "user",
        content:
          `${facts.bio ? `Who he is:\n${facts.bio}\n\n` : ""}` +
          `Today's facts:\n${renderFacts(facts)}` +
          (facts.priorBriefs?.length
            ? `\n\nWHAT THE LAST ${facts.priorBriefs.length} BRIEFS ALREADY SAID — already read, do not say any of it again without a material change:\n` +
              facts.priorBriefs.map(b =>
                `--- ${DateTime.fromISO(b.created_at).setZone(facts.zone).toFormat("cccc d LLLL")} ---\n${b.content}`
              ).join("\n")
            : "")
      }

    ]

  });

  const content = response.choices[0].message.content?.trim();

  return {
    success: true,
    content,
    data: {
      committedHours: facts.day.committedHours,
      overlaps: facts.day.overlaps.length,
      overdue: facts.overdue.length,
      kinds: facts.day.byKind,
      sources: {
        inbox: facts.inbox !== null,
        signals: Boolean(facts.signals),
        people: facts.quiet.length + facts.dates.length
      }
    }
  };

}
