import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";
import { deleteGoogleTask } from "./googleTasks.js";
import { upsertYearlyAllDayEvent, deleteGoogleEvent } from "./googleCalendar.js";
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


async function findPersonById(id) {

  if (!id) return null;

  const { data, error } = await supabase
    .from("people")
    .select("*")
    .eq("id", id)
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


// A deterministic Google Calendar event id per person. Calendar ids are
// base32hex (0-9, a-v), and a UUID with its dashes stripped is 32 valid hex
// characters — so the same person always maps to the same event. That is what
// makes the sync idempotent without having to store an id anywhere.
function importantDateEventId(personId) {
  return "almdate" + String(personId).replace(/-/g, "");
}


function importantDateEventTitle(name, label) {
  return label ? `${name}'s ${label}` : `${name}'s important date`;
}


// One all-day, yearly-recurring calendar event for a person's important date.
// `update:true` on an explicit save (patch it if the date moved); the nightly
// healer passes `update:false` so it only fills a missing event and never
// resurrects one the owner deleted on purpose.
export async function syncImportantDateEvent(person, { tz = null, update = false } = {}) {

  if (!person?.important_date_month || !person?.important_date_day) {
    return { success: true, skipped: "no date" };
  }

  const zone = tz || await getUserTimezone();

  return upsertYearlyAllDayEvent({
    eventId: importantDateEventId(person.id),
    title: importantDateEventTitle(person.name, person.important_date_label),
    month: person.important_date_month,
    day: person.important_date_day,
    tz: zone,
    notes: `${person.name}'s ${person.important_date_label || "important date"}.`,
    update
  });

}


// The nightly healer, and the one-time backfill. Ensures every important date
// on file has its all-day yearly event.
//
// `update:false` — it only fills in an event that is MISSING, and never touches
// or resurrects one that already exists, so a birthday the owner deleted stays
// deleted. New and edited people get their event immediately from savePerson;
// this is the safety net for a Google hiccup during a save, and the backfill
// for anyone saved before calendar events existed. There is nothing to renew:
// RRULE:FREQ=YEARLY carries each date to every future year on its own.
export async function syncAllImportantDateEvents({ update = false } = {}) {

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

  let created = 0;
  let existed = 0;
  const errors = [];

  for (const person of people || []) {

    try {

      const result = await syncImportantDateEvent(person, { tz, update });

      if (result.created) created += 1;
      else if (result.existed || result.updated) existed += 1;

    } catch (error) {
      console.error(`IMPORTANT DATE EVENT for ${person.name} FAILED:`, error.message);
      errors.push({ person: person.name, error: error.message });
    }

  }

  return { success: true, created, existed, errors };

}


// Create-or-update — by id when the caller has one, by name otherwise.
//
// The two lookups exist for two different callers and neither can serve the
// other. Voice has no id: "remember my friend Sarah..." must update Sarah if
// she exists rather than spawn a duplicate, so it matches on name. The edit
// form has the opposite problem: matching on name means a CORRECTED name can
// never match — fixing "Jon Rider" to "Jon Ryder" used to create a second
// person and leave the misspelt one holding all the history. An id makes a
// rename just another field change.
//
// ── Two kinds of absence ─────────────────────────────────────────────────
//
// `null` means "this call didn't mention the field" and leaves it alone —
// required by the voice path, where "add Sam's email" must not wipe his
// phone. `""` means "the user cleared this field" and stores null. A form
// cannot express deletion without this: blanking the phone box used to send
// null, which read as not-mentioned, and the number silently survived its
// own deletion. Same idea for the two numeric fields, where 0 is the clear
// (0 is not a meaningful cadence or calendar month, so nothing is lost).
const provided = (value) => value !== null && value !== undefined;


// Add a note without losing the one already there.
//
// Deliberately dumb: a new line, and a check that the fact is not already on
// file. No model call, no summarising, no rewriting — every one of those can
// lose a detail, and the whole point of this function is that nothing gets
// lost. Growth is fine; this is a notes column, not a budget.
export function mergeNote(existing, incoming) {

  const had = String(existing || "").trim();
  const add = String(incoming || "").trim();

  if (!add) return had || null;
  if (!had) return add;

  // Said again, in the same words. Common: the model restates the standing
  // note alongside the new one, and appending would double it every time.
  const lines = had.split("\n").map(l => l.trim());

  if (lines.includes(add) || had.includes(add)) return had;

  return `${had}\n${add}`;

}

export async function savePerson({
  id = null,
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

  const existing = id ? await findPersonById(id) : await findPersonByName(name);

  // An id names one exact row. If that row is gone, falling through to the
  // insert branch would resurrect a deleted person from whatever the form
  // still held — report it instead.
  if (id && !existing) {
    return { success: false, error: "That person no longer exists — they may have been removed on another device." };
  }

  // ── Notes accumulate; they do not overwrite ─────────────────────────────
  //
  // Voice has no id. "Cooper mentioned a video job up in Schaumburg" arrives
  // as `notes` on a person who already exists, and writing it straight into
  // the column threw away "We split VATHOS 50/50." — a durable fact this
  // table exists to hold, deleted by a sentence that never mentioned it.
  //
  // So on the no-id path a note is APPENDED. The edit form does carry an id,
  // and there the box shows the current text and blank genuinely means blank,
  // so it still replaces. Same two-callers-two-vocabularies split as `provided`.
  const mergedNotes = !id && existing?.notes && provided(notes) && notes
    ? mergeNote(existing.notes, notes)
    : null;

  // A voice save that re-files someone says so out loud. The model is told not
  // to guess this field, but "contact" once overwrote "VATHOS co-founder" in
  // silence, and a relationship is a single value — there is nothing to append
  // it to. Reporting the change is what makes it correctable in the moment.
  const refiled = !id && relationship && existing?.relationship && existing.relationship !== relationship
    ? existing.relationship
    : null;

  const patch = {
    name,
    ...(provided(relationship) && { relationship: relationship || null }),
    ...(provided(notes) && { notes: mergedNotes || notes || null }),
    ...(provided(email) && { email: email || null }),
    ...(provided(phone) && { phone: phone || null }),
    ...(provided(important_date_month) && { important_date_month: important_date_month || null }),
    ...(provided(important_date_day) && { important_date_day: important_date_day || null }),
    ...(provided(important_date_label) && { important_date_label: important_date_label || null }),
    updated_at: new Date().toISOString()
  };

  // Clearing the cadence also has to clear the scheduled next nudge, or the
  // one already on the clock still fires and "don't remind me" reads as a
  // setting that doesn't work.
  if (check_in_days === 0) {
    patch.check_in_days = null;
    patch.next_check_in_at = null;
    check_in_days = null;
  }

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


  let dateEventResult = null;

  const month = important_date_month ?? existing?.important_date_month;
  const day = important_date_day ?? existing?.important_date_day;

  // Whenever this save carries an important date, make (or update) the person's
  // all-day yearly calendar event for it — straight away, not near the day: a
  // recurring calendar event is a marker that should already be on the
  // calendar. update:true so moving the date patches the same event rather than
  // leaving a stale one behind. A Google failure must never fail the save.
  if (important_date_month && important_date_day) {

    try {

      dateEventResult = await syncImportantDateEvent(
        {
          id: person.id,
          name,
          important_date_month: month,
          important_date_day: day,
          important_date_label: important_date_label ?? existing?.important_date_label
        },
        { tz, update: true }
      );

    } catch (error) {
      console.error("PERSON DATE EVENT FAILED:", error.message);
    }

  }


  const remarks = [
    dateEventResult?.created || dateEventResult?.updated
      ? `${important_date_label || "Their date"} is on your calendar as an all-day event, repeating every year.`
      : null,
    // Said out loud because it is the one field here that cannot accumulate.
    refiled
      ? `Filed under "${relationship}" now instead of "${refiled}" — say so if that's wrong.`
      : null,
    mergedNotes && mergedNotes !== existing?.notes
      ? "Added to what was already noted about them rather than replacing it."
      : null,
    staggerOffset > 0
      ? `Check-in moved ${staggerOffset} day${staggerOffset === 1 ? "" : "s"} later so it doesn't land on the same day as someone else.`
      : null
  ].filter(Boolean).join(" ");


  return {

    success: true,

    message: `${existing ? `Updated ${name}.` : `Saved ${name}.`}${remarks ? ` ${remarks}` : ""}`,

    // `id`, not `.data`. upsertYearlyAllDayEvent returns { success, created |
    // existed | updated, id } and never had a `data` key, so the field this
    // replaces reported null on every successful save it ever made — while the
    // identifier it read, `taskResult`, was not declared anywhere in this
    // function at all. A rename during the recurring-reminders work changed the
    // body and missed the return, and since the source-reading tests never
    // execute this line and eslint had no-undef switched off, nothing caught it:
    // every save_person threw "taskResult is not defined" AFTER the row had
    // already been written, so the shortcut reported a failure that had in fact
    // succeeded.
    data: { person, calendarEvent: dateEventResult?.id || null, staggerOffset }

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
// deletion is a lie. A person's birthday becomes a real recurring Google
// Calendar event and their check-ins become prompts, and both outlive the row
// that explains them. Deleting only the row left the phone reminding him about
// the birthday of someone he had explicitly removed, every year, forever, with
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


  // The important-date event is keyed by a deterministic id and has no
  // calendar_events row, so the query above never sees it — delete it directly,
  // or the birthday outlives the person it belonged to. Already-gone is fine
  // (deleteGoogleEvent swallows 404/410).
  try {
    await deleteGoogleEvent(importantDateEventId(id));
  } catch (error) {
    errors.push(`important-date event: ${error.message}`);
  }


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

        content: `You are Almanac answering a question about the user's
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
