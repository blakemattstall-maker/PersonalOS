import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import { MODELS } from "../lib/models.js";
import { buildRichContext } from "../lib/context.js";
import { getUserTimezone } from "../lib/profile.js";
import { getEvents } from "./googleCalendar.js";
import { getTasks, taskDueDate } from "./googleTasks.js";
import { analyseDay } from "../lib/eventKind.js";
import { getAllPeople } from "./people.js";
import { getOpenIntentions, getProjectsWithDetails } from "./database.js";


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

  const settle = (promise, fallback) => promise.then(v => v).catch(() => fallback);

  const [events, tasks, context, people, intentions, projects, inbox] = await Promise.all([
    settle(getEvents({ startDate: todayISO, endDate: todayISO, maxResults: 50 }), { events: [] }),
    settle(getTasks({ maxResults: 100 }), { tasks: [] }),
    settle(buildRichContext(), {}),
    settle(getAllPeople(), []),
    settle(getOpenIntentions(), []),
    settle(getProjectsWithDetails({ status: "active" }), []),
    // Only reachable once the readonly scope is granted; a brief without it is
    // still a brief.
    settle(
      import("./gmail.js").then(m => m.reviewInbox({ days: 3, limit: 25 })),
      { success: false }
    )
  ]);

  const dayEvents = events.events || [];

  return {

    now,
    todayISO,
    zone,

    events: dayEvents,
    day: analyseDay(dayEvents),

    overdue: overdueTasks(tasks.tasks, todayISO),
    dueToday: dueToday(tasks.tasks, todayISO),
    openTaskCount: (tasks.tasks || []).length,

    quiet: peopleGoneQuiet(people, now),
    dates: importantDatesSoon(people, now),

    intentions: (intentions || []).map(i => i.content),
    projects: (projects || []).map(p => ({ name: p.name, next: p.next_action })),

    inbox: inbox?.success ? (inbox.data?.needs_you || []) : null,

    bio: context.bio || null,
    signals: context.signals || null,
    bodyweightTrend: context.bodyweightTrend || null

  };

}


function renderFacts(f) {

  const time = (iso) => iso ? DateTime.fromISO(iso).setZone(f.zone).toFormat("h:mma").toLowerCase() : "";

  const lines = [];

  lines.push(`TODAY: ${f.now.toFormat("cccc, d LLLL yyyy")}`);

  if (f.events.length === 0) {
    lines.push("CALENDAR: nothing scheduled.");
  } else {
    lines.push(`CALENDAR (${f.day.committedHours}h committed across ${f.events.length}):`);
    for (const e of f.events) {
      const when = e.allDay ? "all day" : `${time(e.start)}-${time(e.end)}`;
      const who = e.attendees?.length ? ` with ${e.attendees.join(", ")}` : "";
      lines.push(`  [${e.kind}] ${when} ${e.title}${who}${e.location ? ` @ ${e.location}` : ""}`);
    }
    if (f.day.overlaps.length) {
      lines.push(`  OVERLAPS (already checked, state as fact): ${f.day.overlaps.map(o => `"${o.first}" runs into "${o.second}"`).join("; ")}`);
    }
  }

  if (f.overdue.length) {
    lines.push(`OVERDUE (${f.overdue.length}): ${f.overdue.map(t => `${t.title} (due ${t.due})`).join("; ")}`);
  }

  if (f.dueToday.length) lines.push(`DUE TODAY: ${f.dueToday.join("; ")}`);

  lines.push(`OPEN TASKS: ${f.openTaskCount}`);

  if (f.dates.length) {
    lines.push(`DATES COMING: ${f.dates.map(d => `${d.name}'s ${d.label} in ${d.inDays} day(s)`).join("; ")}`);
  }

  if (f.quiet.length) {
    lines.push(`GONE QUIET: ${f.quiet.map(p => `${p.name} — ${p.days}d since contact, wanted every ${p.cadence}d`).join("; ")}`);
  }

  if (f.inbox?.length) {
    lines.push(`INBOX NEEDS A REPLY: ${f.inbox.map(i => `${i.subject} (from ${i.from}${i.deadline ? `, states ${i.deadline}` : ""})`).join("; ")}`);
  }

  if (f.projects.length) {
    lines.push(`PROJECTS: ${f.projects.map(p => `${p.name}${p.next ? ` — next: ${p.next}` : ""}`).join("; ")}`);
  }

  if (f.intentions.length) lines.push(`STANDING INTENTIONS: ${f.intentions.join("; ")}`);

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
an assistant reading a list back to them — you are the person who has already
looked at everything and decided what actually matters today.

Voice: blunt, specific, no hedging, no cheerleading. He has explicitly asked
never to have things softened, and never to be congratulated for existing. Do
not open with a greeting, do not use his name, do not say "here's your brief".
Start with the thing that matters most.

Hard rules:
- Every figure below is already calculated. Use them as given. Do NOT do
  arithmetic of your own and do not recompute times, totals or day counts.
- Do not list the calendar back in order. Anyone can read a calendar. Say what
  the shape of the day is, what will actually be hard about it, and what is
  worth protecting or moving.
- Distinguish what kind of thing each entry is. A meeting with other people, an
  appointment, an hour he set aside for himself and a bare reminder are not the
  same and must not be described as if they were.
- Only mention money, relationships, projects or email when there is something
  genuinely worth saying. Silence on a domain is correct and expected.
- If two things collide, say so plainly and say which one should move.
- No markdown, no headings, no bullet characters. Flowing prose in short
  paragraphs, the way a sharp person would actually tell you.
- Three short paragraphs at most. Being complete is worth less than being read.
`
      },

      {
        role: "user",
        content:
          `${facts.bio ? `Who he is:\n${facts.bio}\n\n` : ""}` +
          `Today's facts:\n${renderFacts(facts)}`
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
