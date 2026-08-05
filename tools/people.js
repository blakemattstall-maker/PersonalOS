import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";
import { createEvent } from "./googleCalendar.js";


// Relationship management — Blake's framing, not a resurrection of anything
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


function computeNextCheckIn(check_in_days, tz) {
  if (!check_in_days) return null;
  return DateTime.now().setZone(tz).plus({ days: check_in_days }).toISO();
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


async function scheduleImportantDateEvent({ person_id, name, month, day, label, tz }) {

  const date = nextOccurrence(month, day, tz);

  if (!date) return null;

  const title = label ? `${name} — ${label}` : `${name}'s important date`;

  // A plain reminder, not a real appointment — 9am keeps it off whatever
  // else is actually scheduled that morning without needing all-day-event
  // support, which createEvent doesn't have yet.
  return createEvent({
    title,
    year: date.year,
    month: date.month,
    day: date.day,
    hour: 9,
    minute: 0,
    durationMinutes: 30,
    person_id
  });

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

  if (check_in_days !== null) {
    patch.check_in_days = check_in_days;
    patch.next_check_in_at = computeNextCheckIn(check_in_days, tz);
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


  let eventResult = null;

  const month = important_date_month ?? existing?.important_date_month;
  const day = important_date_day ?? existing?.important_date_day;

  // Only schedule when this call actually supplied the date — re-saving
  // someone for an unrelated reason (a new note, a check-in cadence change)
  // shouldn't silently create a fresh reminder every time.
  if (important_date_month && important_date_day) {

    try {

      eventResult = await scheduleImportantDateEvent({
        person_id: person.id,
        name,
        month,
        day,
        label: important_date_label ?? existing?.important_date_label,
        tz
      });

    } catch (error) {
      console.error("PERSON EVENT SCHEDULING FAILED:", error.message);
    }

  }


  return {

    success: true,

    message: existing
      ? `Updated ${name}.${eventResult ? ` Added a calendar reminder for ${important_date_label || "their date"}.` : ""}`
      : `Saved ${name}.${eventResult ? ` Added a calendar reminder for ${important_date_label || "their date"}.` : ""}`,

    data: { person, event: eventResult?.data || null }

  };

}


export async function recordContact({ name }) {

  const person = await findPersonByName(name);

  if (!person) {
    return { success: false, error: `Don't have anyone named "${name}" saved yet.` };
  }

  const tz = await getUserTimezone();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("people")
    .update({
      last_contacted_at: now,
      next_check_in_at: computeNextCheckIn(person.check_in_days, tz),
      updated_at: now
    })
    .eq("id", person.id);

  if (error) throw new Error(error.message);

  return { success: true, message: `Logged that you talked to ${person.name}.` };

}


export async function deletePerson(id) {

  const { error } = await supabase.from("people").delete().eq("id", id);

  if (error) throw new Error(error.message);

  return { success: true };

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

    model: "gpt-5.4-mini",

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

  if (person && answer && answer !== "dismissed") {

    await supabase
      .from("people")
      .update({ last_contacted_at: now, next_check_in_at: computeNextCheckIn(person.check_in_days, tz), updated_at: now })
      .eq("id", person.id);

  } else if (person) {

    await supabase
      .from("people")
      .update({ next_check_in_at: computeNextCheckIn(person.check_in_days, tz), updated_at: now })
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
      status: "pending"
    }]);

    prompted += 1;

  }

  return { success: true, checked: due.length, prompted };

}
