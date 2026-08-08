import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";
import { createTask, deleteGoogleTask } from "./googleTasks.js";
import { deleteGoogleEvent } from "./googleCalendar.js";
import { sendPush } from "../lib/push.js";
import { pushAllowed } from "../lib/settings.js";
import { mapWithConcurrency } from "../lib/async.js";
import { MODELS } from "../lib/models.js";


// Relationship management — the user's framing, not a resurrection of anything
// half-built: a people table other features reference, not a standalone
// silo. Two things actually happen with a person record beyond "read it
// back": an important date can become a real calendar event, and going
// quiet past a chosen interval raises a check-in prompt, the same way an
// unlabelled place or a daily observation does.


function missingTable(error) {
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}


async function findPersonByName(name) {

  if (!name) return null;

  const { data, error } = await supabase
    .from("people")
    .select("*")
    .ilike("name", name.trim())
    .limit(1);

  if (error) {
    if (missingTable(error)) return null;
    throw new Error(error.message);
  }

  return data?.[0] || null;

}


// Check-ins must not pile up on one day.
//
// This used to be simply now + check_in_days, which means saving five people in
// one sitting schedules all five to come due on the same morning — and because
// answering a check-in resets from *that* day, the pile-up is self-sustaining
// rather than a one-off. Ten prompts on a Tuesday and none for a fortnight is
// precisely the pattern that gets a feature muted.
//
// So the target date is nudged forward until it lands on a day no one else is
// already due. Forward only: pulling it earlier would shorten a cadence the
// user explicitly chose. The search is bounded, and if a whole window is full
// the unshifted date is used rather than drifting arbitrarily far.
const MAX_STAGGER_DAYS = 6;


async function computeNextCheckIn(check_in_days, tz, { excludePersonId = null, stagger = true } = {}) {

  if (!check_in_days) return { iso: null, offset: 0 };

  const target = DateTime.now().setZone(tz).plus({ days: check_in_days });

  if (!stagger) return { iso: target.toISO(), offset: 0 };

  // Everyone already scheduled anywhere near the target.
  const windowStart = target.minus({ days: 1 }).startOf("day");
  const windowEnd = target.plus({ days: MAX_STAGGER_DAYS + 1 }).endOf("day");

  let query = supabase
    .from("people")
    .select("id, next_check_in_at")
    .not("next_check_in_at", "is", null)
    .gte("next_check_in_at", windowStart.toISO())
    .lte("next_check_in_at", windowEnd.toISO());

  if (excludePersonId) query = query.neq("id", excludePersonId);

  const { data: neighbours, error } = await query;

  // A failed lookup must not stop the person being saved — an unstaggered
  // date is a mild annoyance, a failed save is a lost relationship record.
  if (error) return { iso: target.toISO(), offset: 0 };

  const taken = new Set(
    (neighbours || []).map(p => DateTime.fromISO(p.next_check_in_at).setZone(tz).toFormat("yyyy-MM-dd"))
  );

  for (let offset = 0; offset <= MAX_STAGGER_DAYS; offset += 1) {

    const candidate = target.plus({ days: offset });

    if (!taken.has(candidate.toFormat("yyyy-MM-dd"))) {
      return { iso: candidate.toISO(), offset };
    }

  }

  return { iso: target.toISO(), offset: 0 };

}


// Next real calendar date this month/day falls on — today if it's today,
// otherwise the next time it comes around, never a date already past.
// Known gap, deliberately unhandled: Feb 29 in a non-leap-year target year
// returns null (DateTime.fromObject correctly rejects it), so that person's
// reminder silently doesn't get scheduled that year. Falling back to Feb 28
// vs Mar 1 is a genuine judgment call either way — not obviously worth
// guessing at for how rarely it applies.
function nextOccurrence(month, day, tz) {

  const now = DateTime.now().setZone(tz).startOf("day");

  let candidate = DateTime.fromObject({ year: now.year, month, day }, { zone: tz });

  if (!candidate.isValid) return null;

  if (candidate < now) {
    candidate = DateTime.fromObject({ year: now.year + 1, month, day }, { zone: tz });
  }

  return candidate;

}


// How many days before the date the reminder task is due. Enough warning to
// actually do something about it — buy a present, plan a call — rather than
// finding out on the morning.
export const DATE_REMINDER_LEAD_DAYS = 7;


export function dateReminderTitle(name, label) {
  return label ? `${name} — ${label}` : `${name}'s important date`;
}


// A birthday is a TASK, not a calendar event.
//
// It was an event, and that was wrong twice over. A calendar is for things that
// occupy time, and a birthday reminder occupies none — it just cluttered the
// week. Worse, it was written as a single one-off occurrence, so the reminder
// existed for exactly one year and then silently never appeared again.
//
// Google's Tasks API has NO recurrence field — recurring tasks exist in the
// Google UI but are not exposed through v1 at all — so recurrence is ours to
// run. materialiseUpcomingDateReminders() below is called daily and creates
// each year's task as the date comes back around, made idempotent by a unique
// recurrence_key rather than by checking first.
async function scheduleImportantDateTask({ person_id, name, month, day, label, tz }) {

  const date = nextOccurrence(month, day, tz);

  if (!date) return null;

  const due = date.minus({ days: DATE_REMINDER_LEAD_DAYS });

  return createTask({
    title: dateReminderTitle(name, label),
    year: due.year,
    month: due.month,
    day: due.day,
    hour: 9,
    minute: 0,
    timezone: tz,
    person_id,
    recurrence_key: `person:${person_id}:${label || "date"}:${date.year}`,
    notes: `${name}'s ${label || "important date"} is ${date.toFormat("MMMM d")}.`
  });

}


// Called daily. Anyone whose important date is now inside the lead window gets
// this year's reminder created; the unique index makes a repeat run a no-op.
// This IS the recurrence engine — there is nothing to renew or expire.
export async function materialiseUpcomingDateReminders() {

  const tz = await getUserTimezone();

  const { data: people, error } = await supabase
    .from("people")
    .select("id, name, important_date_month, important_date_day, important_date_label")
    .not("important_date_month", "is", null)
    .not("important_date_day", "is", null);

  if (error) {
    if (missingTable(error)) return { success: true, skipped: "people table not set up yet" };
    throw new Error(error.message);
  }

  const now = DateTime.now().setZone(tz).startOf("day");

  let created = 0;
  let alreadyThere = 0;

  const errors = [];

  for (const person of people || []) {

    const date = nextOccurrence(person.important_date_month, person.important_date_day, tz);

    if (!date) continue;

    const due = date.minus({ days: DATE_REMINDER_LEAD_DAYS });

    // Not yet inside the window — nothing to do until closer to the day.
    if (due > now) continue;

    try {

      const result = await scheduleImportantDateTask({
        person_id: person.id,
        name: person.name,
        month: person.important_date_month,
        day: person.important_date_day,
        label: person.important_date_label,
        tz
      });

      if (result?.duplicate) alreadyThere += 1;
      else if (result?.success) created += 1;

    } catch (error) {
      errors.push({ person: person.name, error: error.message });
    }

  }

  return { success: true, created, alreadyThere, errors };

}


// Create-or-update by name — a voice-driven "remember my friend Sarah..."
// should update Sarah if she already exists, not spawn a duplicate every
// time something new is learned about her.
export async function savePerson({
  name,
  relationship = null,
  notes = null,
  email = null,
  phone = null,
  check_in_days = null,
  important_date_month = null,
  important_date_day = null,
  important_date_label = null
}) {

  if (!name) throw new Error("A person needs a name.");

  const tz = await getUserTimezone();

  const existing = await findPersonByName(name);

  const patch = {
    name,
    ...(relationship !== null && { relationship }),
    ...(notes !== null && { notes }),
    ...(email !== null && { email }),
    ...(phone !== null && { phone }),
    ...(important_date_month !== null && { important_date_month }),
    ...(important_date_day !== null && { important_date_day }),
    ...(important_date_label !== null && { important_date_label }),
    updated_at: new Date().toISOString()
  };

  let staggerOffset = 0;

  if (check_in_days !== null) {

    const next = await computeNextCheckIn(check_in_days, tz, { excludePersonId: existing?.id });

    patch.check_in_days = check_in_days;
    patch.next_check_in_at = next.iso;

    staggerOffset = next.offset;

  }

  let person;

  if (existing) {

    const { data, error } = await supabase
      .from("people")
      .update(patch)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    person = data;

  } else {

    const { data, error } = await supabase
      .from("people")
      .insert([patch])
      .select()
      .single();

    if (error) {

      if (missingTable(error)) {
        return { success: false, error: "The people table doesn't exist yet — run docs/schema-people.sql in Supabase." };
      }

      throw new Error(error.message);

    }

    person = data;

  }


  let taskResult = null;

  const month = important_date_month ?? existing?.important_date_month;
  const day = important_date_day ?? existing?.important_date_day;

  // Only schedule when this call actually supplied the date — re-saving
  // someone for an unrelated reason (a new note, a check-in cadence change)
  // shouldn't silently create a fresh reminder every time.
  //
  // And only when the date is already inside the lead window; otherwise the
  // daily job picks it up nearer the time. Creating a task due in eleven
  // months would just sit at the bottom of the list being ignored.
  if (important_date_month && important_date_day) {

    try {

      const date = nextOccurrence(month, day, tz);
      const due = date?.minus({ days: DATE_REMINDER_LEAD_DAYS });

      if (due && due <= DateTime.now().setZone(tz).startOf("day")) {

        taskResult = await scheduleImportantDateTask({
          person_id: person.id,
          name,
          month,
          day,
          label: important_date_label ?? existing?.important_date_label,
          tz
        });

      }

    } catch (error) {
      console.error("PERSON DATE REMINDER FAILED:", error.message);
    }

  }


  const remarks = [
    taskResult?.success && !taskResult?.duplicate
      ? `Added a reminder task for ${important_date_label || "their date"}.`
      : null,
    month && day && !taskResult
      ? `${important_date_label || "Their date"} is saved — the reminder task appears ${DATE_REMINDER_LEAD_DAYS} days before, every year.`
      : null,
    staggerOffset > 0
      ? `Check-in moved ${staggerOffset} day${staggerOffset === 1 ? "" : "s"} later so it doesn't land on the same day as someone else.`
      : null
  ].filter(Boolean).join(" ");


  return {

    success: true,

    message: `${existing ? `Updated ${name}.` : `Saved ${name}.`}${remarks ? ` ${remarks}` : ""}`,

    data: { person, task: taskResult?.data || null, staggerOffset }

  };

}


export async function recordContact({ name }) {

  const person = await findPersonByName(name);

  if (!person) {
    return { success: false, error: `Don't have anyone named "${name}" saved yet.` };
  }

  const tz = await getUserTimezone();
  const now = new Date().toISOString();

  const next = await computeNextCheckIn(person.check_in_days, tz, { excludePersonId: person.id });

  const { error } = await supabase
    .from("people")
    .update({
      last_contacted_at: now,
      next_check_in_at: next.iso,
      updated_at: now
    })
    .eq("id", person.id);

  if (error) throw new Error(error.message);

  return {
    success: true,
    message: `Logged that you talked to ${person.name}.${
      next.iso ? ` Next nudge ${DateTime.fromISO(next.iso).setZone(tz).toRelativeCalendar()}.` : ""
    }`
  };

}


// Removing someone has to remove what the app built on their behalf, or the
// deletion is a lie. A person's birthday becomes a real recurring Google Task
// (materialiseUpcomingDateReminders creates one per year as the date comes into
// range), their check-ins become prompts, and both outlive the row that
// explains them. Deleting only the row left the phone reminding him about the
// birthday of someone he had explicitly removed, every year, forever, with
// nothing left in the system saying who it was for.
//
// Google is cleaned up first and the row goes last: a failure partway through
// leaves the person still present and retryable, which is recoverable. The
// reverse order would leave orphans nothing can find.
export async function deletePerson(id) {

  if (!id) throw new Error("deletePerson requires an id.");

  const removed = { tasks: 0, events: 0, prompts: 0 };

  const errors = [];


  const [{ data: tasks }, { data: events }] = await Promise.all([
    supabase.from("tasks").select("id, google_task_id").eq("person_id", id),
    supabase.from("calendar_events").select("id, google_event_id").eq("person_id", id)
  ]);


  await mapWithConcurrency(tasks || [], async (task) => {
    try {
      await deleteGoogleTask(task.google_task_id);
      removed.tasks += 1;
    } catch (error) {
      errors.push(`task ${task.id}: ${error.message}`);
    }
  });

  await mapWithConcurrency(events || [], async (event) => {
    try {
      await deleteGoogleEvent(event.google_event_id);
      removed.events += 1;
    } catch (error) {
      errors.push(`event ${event.id}: ${error.message}`);
    }
  });


  // Anything still awaiting an answer about this person can no longer be
  // answered. Cancelled rather than deleted — the prompt history is the record
  // of what the app asked and why, and that stays true even once they're gone.
  const { data: pending } = await supabase
    .from("prompts")
    .select("id, payload")
    .eq("status", "pending");

  const theirs = (pending || []).filter(p => p.payload?.person_id === id).map(p => p.id);

  if (theirs.length > 0) {

    const { error } = await supabase
      .from("prompts")
      .update({ status: "cancelled", answered_at: new Date().toISOString() })
      .in("id", theirs);

    if (error) errors.push(`prompts: ${error.message}`);
    else removed.prompts = theirs.length;

  }


  if (tasks?.length) {
    await supabase.from("tasks").delete().eq("person_id", id);
  }

  if (events?.length) {
    await supabase.from("calendar_events").delete().eq("person_id", id);
  }


  const { error } = await supabase.from("people").delete().eq("id", id);

  if (error) throw new Error(error.message);


  return {
    success: true,
    message: `Removed them, plus ${removed.tasks} reminder(s) and ${removed.events} event(s) — from Google too, not just here.`,
    removed,
    ...(errors.length > 0 ? { errors } : {})
  };

}


export async function getAllPeople() {

  const { data, error } = await supabase
    .from("people")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }

  return data || [];

}


export async function queryPeople({ question } = {}) {

  const [people, bio] = await Promise.all([getAllPeople(), getProfileBio()]);

  if (people.length === 0) {
    return {
      success: true,
      message: "No one saved yet.",
      data: { question, answer: "No one saved yet.", peopleCount: 0 }
    };
  }

  const tz = await getUserTimezone();

  const formatted = people.map(p => {

    const lastContact = p.last_contacted_at
      ? DateTime.fromISO(p.last_contacted_at).setZone(tz).toFormat("MMM d, yyyy")
      : "never logged";

    const dateNote = p.important_date_month
      ? `, ${p.important_date_label || "important date"}: ${p.important_date_month}/${p.important_date_day}`
      : "";

    return `${p.name} (${p.relationship || "no relationship noted"}) — last contact: ${lastContact}${dateNote}. ${p.notes || ""}`.trim();

  }).join("\n");

  const response = await openai.chat.completions.create({

    model: MODELS.EXTRACT,

    messages: [

      {
        role: "system",

        content: `You are PersonalOS answering a question about the user's
saved relationships.

Who you're talking to:
${bio || "(no profile saved yet)"}

Saved people:
${formatted}

RULES:
- Answer only from the list above. Never invent a person, a date or a fact
  not written there.
- Your answer is read aloud or shown on a phone screen. Plain text only, no
  markdown, no bullets, no headers. Be brief and conversational.`
      },

      {
        role: "user",
        content: question || "Who do I know?"
      }

    ]

  });

  const answer = response.choices[0].message.content;

  return {
    success: true,
    message: answer,
    data: { question, answer, peopleCount: people.length }
  };

}


// Answering the "check in with X?" prompt from the dashboard. A real answer
// counts as the contact itself — logs it and resets the clock, same as
// log_contact. Dismissing pushes the clock forward by the same interval
// rather than leaving it in the past, which would otherwise re-raise the
// identical prompt on tomorrow's cron run.
export async function answerRelationshipCheckin({ prompt_id, person_id, answer }) {

  const { data: person } = await supabase
    .from("people")
    .select("id, name, check_in_days")
    .eq("id", person_id)
    .single();

  const tz = await getUserTimezone();
  const now = new Date().toISOString();

  if (person) {

    const next = await computeNextCheckIn(person.check_in_days, tz, { excludePersonId: person.id });

    await supabase
      .from("people")
      .update({
        // A real answer counts as the contact itself. Dismissing only pushes
        // the clock forward, so the identical prompt isn't re-raised tomorrow.
        ...(answer && answer !== "dismissed" ? { last_contacted_at: now } : {}),
        next_check_in_at: next.iso,
        updated_at: now
      })
      .eq("id", person.id);

  }

  await supabase
    .from("prompts")
    .update({ status: "answered", answer: answer || "dismissed", answered_at: now })
    .eq("id", prompt_id);

  return { success: true, message: person ? `Got it — logged ${person.name}.` : "Got it." };

}


// Cron-called. Anyone whose next_check_in_at has passed gets exactly one
// pending prompt — dedup mirrors the label_place pattern in tools/location.js
// so a daily run doesn't stack a fresh nudge on top of one still unanswered.
export async function checkRelationshipCheckins() {

  const now = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("people")
    .select("id, name, relationship, check_in_days, last_contacted_at")
    .lte("next_check_in_at", now);

  if (error) {
    if (missingTable(error)) return { success: true, skipped: "people table not set up yet" };
    throw new Error(error.message);
  }

  if (!due || due.length === 0) {
    return { success: true, checked: 0, prompted: 0 };
  }

  let prompted = 0;
  let pushed = 0;

  for (const person of due) {

    const { data: existingPrompt } = await supabase
      .from("prompts")
      .select("id")
      .eq("kind", "relationship_checkin")
      .eq("status", "pending")
      .contains("payload", { person_id: person.id })
      .limit(1);

    if (existingPrompt && existingPrompt.length > 0) continue;

    await supabase.from("prompts").insert([{
      kind: "relationship_checkin",
      title: `Check in with ${person.name}?`,
      body: `You said you'd check in with ${person.name}${person.relationship ? ` (${person.relationship})` : ""} every ${person.check_in_days} days. ${
        person.last_contacted_at ? `Last logged contact was a while back.` : "No contact logged yet."
      }`,
      payload: { person_id: person.id },
      status: "pending",
      pushed_at: new Date().toISOString()
    }]);

    prompted += 1;

    // These go to the phone rather than the calendar. A check-in isn't an
    // appointment — putting it on the calendar was clutter, and leaving it
    // only on the dashboard meant it was never seen unless the dashboard
    // happened to be opened.
    //
    // The prompt row is written either way: muting notifications should mean
    // "stop buzzing me", not "stop tracking". Staggering upstream is what
    // keeps this to roughly one person a day rather than a burst.
    if (await pushAllowed("relationship_checkin")) {

      const result = await sendPush({
        title: `Check in with ${person.name}?`,
        body: person.relationship
          ? `It's been a while — ${person.relationship}.`
          : "It's been a while.",
        url: "/",
        tag: `checkin-${person.id}`
      }).catch(() => null);

      if (result?.sent) pushed += 1;

    }

  }

  return { success: true, checked: due.length, prompted, pushed };

}
