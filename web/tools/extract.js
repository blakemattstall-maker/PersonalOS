import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";
import { logActivity } from "./activityLog.js";


// What the app learns from something you said, whether or not you asked it to.
//
// ── the failure this exists to end ───────────────────────────────────────
//
// "I'm racing my roommate to a muscle-up. Currently we can both do 6-7 pull
// ups" produced a good answer and NOTHING ELSE. No project, no memory, no goal.
// The strings "muscle up" and "pull up" appeared in zero rows of every table
// that stores what the system knows.
//
// Three separate reasons, all structural rather than a bad model call:
//
//   · the router's taxonomy is change-something / make-an-artefact / ask-
//     something, and a declarative statement of fact is none of those;
//   · answerQuestion (tools/answer.js) has no supabase import at all — every
//     capture routed to general_question is GUARANTEED to write nothing;
//   · there is no create_project or create_goal tool among the twenty-nine the
//     router can call, so a project has never been creatable by speaking. Both
//     tables are empty.
//
// So this is not another tool the router might pick. It is a pass that runs on
// every capture after the tools have, sees the verbatim words, and writes what
// is durable in them. A tool can be not-chosen. A pass cannot.
//
// ── what it will not do ──────────────────────────────────────────────────
//
// Memories go through saveMemory, which checks for duplicates already — say
// the same thing four times and it merges rather than storing it four times.
//
// createProject does NOT, and assuming it did would have been the bug: it is a
// bare insert (tools/database.js), and lib/dedupe.js is hardcoded to a
// `content` column while a project's text lives in `name`. So the containment
// check below is this file's own, and it is deliberately blunt — a name that
// contains, or is contained by, one already on file is the same project.
//
// It never inserts a prompts row: two places filing the same answer is a bug
// this codebase has already had, and lib/captureNotify.js owns that. And it
// never throws into the caller — the phone is waiting on a reply, and a lost
// fact must not become a failed capture.


// Facts that are already someone else's job. If the router just saved a note,
// extraction restating it as a memory is the four-copies problem again.
const ALREADY_PERSISTED = new Set([
  "save_memory", "save_note", "save_intention", "save_person",
  "create_task", "create_event", "log_bodyweight", "log_meal", "log_contact"
]);


const SCHEMA = `Return ONLY JSON of this shape:

{
  "memories":  [{ "content": "one durable fact, third person, dated if it matters", "importance": 1-10 }],
  "projects":  [{ "name": "short name", "description": "what it is and what done looks like", "next_action": "the very next physical step" }],
  "triggers":  [{
     "kind": "place_arrival" | "before_event" | "time_of_day",
     "label": "short, shown on the notification",
     "place": "the name of the place, for place_arrival",
     "event_match": "a word that appears in the calendar event title, for before_event",
     "lead_minutes": 30,
     "at_time": "HH:MM",
     "message": "what the notification should say",
     "asks": "a question to ask him, or null",
     "log_kind": "short_snake_case name for the series, or null"
  }]
}

Every array may be empty. Empty is the common case and the right answer for
small talk, for a question with no new facts in it, and for anything already
saved by a tool this turn.`;


const GUIDANCE = `You are the part of a personal assistant that decides what is worth KEEPING
from something its owner just said. You are not answering him — that already happened.

MEMORIES — a fact that will still be true and still be useful in a month.
  · "Racing his roommate to a first muscle-up; both could do 6-7 pull-ups in August 2026" — yes.
  · "Asked whether losing weight or more pull-ups helps more" — no, that is the question, not a fact.
  · Write them in the third person, and date anything that will age.

PROJECTS — something with an end state he is actively working toward, that will
take more than one sitting. A competition, a build, an application. Not a chore,
not a one-off task, not a topic he merely asked about.
  · "racing my roommate to a muscle-up" — yes, that is a project with a finish line.
  · "what should I eat tonight" — no.

TRIGGERS — a standing instruction about WHEN he wants to be told something. This
is the one that matters most, because the alternative is telling him to go and
set a reminder himself, which is the assistant asking him to do its job.
  · "remind me before barbell meetings to capture media" -> before_event,
    event_match "barbell", lead_minutes 30.
  · "when I'm at the gym, tell me to practise negatives and ask how many I got"
    -> place_arrival, place "gym", asks "How many did you get?", log_kind "muscle_up".
  · Only create one when he actually expressed a standing want. Never invent a
    reminder he did not ask for.
  · If he describes practising or training toward something REPEATEDLY at a
    place, a place_arrival trigger that asks for the count is usually right —
    that is how progress gets tracked at all.

Be conservative. An empty result is a good result. The cost of a wrong project
is clutter he has to clean up; the cost of a missed one is nothing, because he
will say it again.`;


// Turn a spoken place name into a real one, a spoken kind into a real one, and
// refuse anything that will not fire.
//
// The model proposes; this disposes. Every field that decides behaviour is
// validated here in code rather than trusted, so a hallucinated place name or a
// nonsense kind becomes a skipped trigger and not a row that never fires and
// never says why.
async function resolveTrigger(spec) {

  const { findPlaceByName } = await import("./triggers.js");

  const kind = String(spec.kind || "").trim();

  if (!["place_arrival", "before_event", "time_of_day"].includes(kind)) return null;

  if (!spec.label || !spec.message) return null;

  const base = {
    kind,
    label: String(spec.label).slice(0, 80),
    message: String(spec.message).slice(0, 300),
    asks: spec.asks ? String(spec.asks).slice(0, 200) : null,
    log_kind: spec.log_kind ? String(spec.log_kind).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) : null,
    source: "capture"
  };

  if (kind === "place_arrival") {

    const place = await findPlaceByName(spec.place);

    // No place, no trigger. A place_arrival row with a null place_id can never
    // fire, and would sit in the list looking like it works.
    if (!place) return null;

    return {
      ...base,
      place_id: place.id,
      // Ten minutes of being there, because a saved place is a circle a hundred
      // metres wide and he walks past several of them on the way to class.
      dwell_minutes: 10,
      placeLabel: place.label
    };

  }

  if (kind === "before_event") {

    const match = String(spec.event_match || "").trim();

    if (match.length < 3) return null;

    const lead = Number(spec.lead_minutes);

    return {
      ...base,
      event_match: match,
      lead_minutes: Number.isFinite(lead) && lead > 0 && lead <= 24 * 60 ? Math.round(lead) : 30
    };

  }

  const at = String(spec.at_time || "").match(/^(\d{1,2}):(\d{2})$/);

  if (!at) return null;

  const hour = Number(at[1]);
  const minute = Number(at[2]);

  if (hour > 23 || minute > 59) return null;

  return { ...base, at_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };

}


// Has he already got a project about this? Cheap containment check rather than
// a model call — the point is only to stop a fourth "Muscle-up race" appearing.
function alreadyHaveProject(existing, name) {

  const wanted = String(name || "").toLowerCase().trim();

  if (!wanted) return true;

  return existing.some(p => {
    const have = String(p.name || "").toLowerCase();
    return have === wanted || have.includes(wanted) || wanted.includes(have);
  });

}


// The pass itself.
//
// `results` is what the tools already did this turn, so anything they persisted
// is left alone. Returns a one-line summary for the reply, or null when nothing
// was worth keeping — which is most of the time, and is fine.
export async function extractDurableFacts(text, results = []) {

  const said = String(text || "").trim();

  // Not worth a model call: a couple of words carries nothing durable, and this
  // runs on the path the phone is waiting on.
  if (said.length < 25) return null;

  const handled = (results || [])
    .map(r => r.tool)
    .filter(tool => ALREADY_PERSISTED.has(tool));

  try {

    const { getOpenAI } = await import("../lib/openai.js");

    const [{ data: projects }, { data: recentMemories }] = await Promise.all([
      supabase.from("projects").select("id, name, status"),
      supabase.from("memories").select("content").order("created_at", { ascending: false }).limit(40)
    ]);

    const existingProjects = projects || [];

    const response = await getOpenAI().chat.completions.create({
      model: MODELS.EXTRACT,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${GUIDANCE}\n\n${SCHEMA}` },
        {
          role: "user",
          content: [
            `HE SAID: ${said}`,
            handled.length ? `\nAlready saved this turn by: ${handled.join(", ")}. Do not restate any of it.` : "",
            existingProjects.length ? `\nProjects that already exist: ${existingProjects.map(p => p.name).join("; ")}` : "\nHe has no projects saved yet.",
            recentMemories?.length ? `\nRecently remembered:\n${recentMemories.slice(0, 20).map(m => `- ${m.content}`).join("\n")}` : ""
          ].filter(Boolean).join("\n")
        }
      ]
    });

    let parsed;

    try {
      parsed = JSON.parse(response.choices[0].message.content);
    } catch {
      await logActivity({
        action: "capture_extract", input: { said: said.slice(0, 200) },
        output: { error: "unparseable JSON" }, success: false, source: "shortcut"
      }).catch(() => {});
      return null;
    }

    const saved = { memories: [], projects: [], triggers: [] };

    // Each write in its own try, so one failure never costs the others. The
    // shape is copied from persistLearnings in tools/thread.js, which learned
    // this the same way.
    const { saveMemory } = await import("./memory.js");

    for (const memory of (parsed.memories || []).slice(0, 3)) {

      if (!memory?.content || String(memory.content).trim().length < 10) continue;

      try {
        const result = await saveMemory("fact", String(memory.content).trim(), Number(memory.importance) || 5);
        // saveMemory reports a duplicate rather than writing one; not worth
        // telling him about something he was already told.
        if (result?.success && !result.duplicate) saved.memories.push(memory.content);
      } catch (error) {
        console.error("EXTRACT MEMORY FAILED:", error.message);
      }

    }

    const { createProject } = await import("./database.js");

    for (const project of (parsed.projects || []).slice(0, 2)) {

      if (!project?.name || alreadyHaveProject(existingProjects, project.name)) continue;

      try {
        const created = await createProject({
          name: String(project.name).slice(0, 120),
          description: project.description ? String(project.description).slice(0, 600) : null,
          next_action: project.next_action ? String(project.next_action).slice(0, 300) : null
        });
        if (created?.id) {
          saved.projects.push(created.name);
          existingProjects.push(created);
        }
      } catch (error) {
        console.error("EXTRACT PROJECT FAILED:", error.message);
      }

    }

    const { createTrigger } = await import("./triggers.js");

    for (const spec of (parsed.triggers || []).slice(0, 2)) {

      try {

        const resolved = await resolveTrigger(spec);

        if (!resolved) continue;

        const { placeLabel, ...row } = resolved;

        // Tie it to the project this turn created, when there is one, so the
        // graph can show why the reminder exists.
        const subject = saved.projects.length
          ? existingProjects.find(p => p.name === saved.projects[0])
          : null;

        const created = await createTrigger({
          ...row,
          ...(subject ? { subject_type: "project", subject_id: subject.id } : {})
        });

        if (created?.success) {
          saved.triggers.push(
            row.kind === "place_arrival" ? `${row.label} (when you get to ${placeLabel})`
              : row.kind === "before_event" ? `${row.label} (${row.lead_minutes}m before "${row.event_match}")`
              : `${row.label} (at ${row.at_time})`
          );
        }

      } catch (error) {
        console.error("EXTRACT TRIGGER FAILED:", error.message);
      }

    }

    const total = saved.memories.length + saved.projects.length + saved.triggers.length;

    // A heartbeat either way. A pass that quietly stops finding anything looks
    // exactly like a quiet week, and this is the only way to tell them apart.
    await logActivity({
      action: "capture_extract",
      input: { said: said.slice(0, 200) },
      output: { ...saved, total },
      success: true,
      source: "shortcut"
    }).catch(() => {});

    if (total === 0) return null;

    // What he gets told. He asked to be told when the app does something on its
    // own, and a trigger created silently is the same failure as a nudge that
    // tells him to go and set one.
    const parts = [];

    if (saved.triggers.length) parts.push(`I'll remind you: ${saved.triggers.join("; ")}`);
    if (saved.projects.length) parts.push(`Started tracking "${saved.projects.join('", "')}"`);
    if (saved.memories.length) parts.push(`Noted ${saved.memories.length} thing${saved.memories.length === 1 ? "" : "s"}`);

    return { summary: `${parts.join(". ")}.`, saved };

  } catch (error) {

    console.error("CAPTURE EXTRACT FAILED:", error.message);

    await logActivity({
      action: "capture_extract", input: { said: said.slice(0, 200) },
      output: { error: error.message }, success: false, source: "shortcut"
    }).catch(() => {});

    return null;

  }

}
