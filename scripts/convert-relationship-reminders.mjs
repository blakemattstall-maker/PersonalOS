// One-off conversion: birthday CALENDAR EVENTS -> recurring reminder TASKS,
// plus a re-stagger of every existing check-in.
//
// Run once, after docs/schema-accountability.sql:
//
//   set -a && source .env.local && set +a && node scripts/convert-relationship-reminders.mjs
//
// Pass --dry to see what it would do without touching anything.
//
// Why this exists: four birthdays were already written as one-off calendar
// events for their next occurrence. Leaving them would mean the same reminder
// arriving twice in different places this year, and then never again after it.
// The new engine (materialiseUpcomingDateReminders) creates each year's task
// when the date comes into range, so these events just need removing — the
// person rows already carry the month/day and nothing else is needed.

import { google } from "googleapis";
import { DateTime } from "luxon";

import supabase from "../lib/supabase.js";
import { getGoogleClient } from "../lib/google.js";
import { getUserTimezone } from "../lib/profile.js";


const DRY = process.argv.includes("--dry");

const log = (...args) => console.log(DRY ? "[dry]" : "[run]", ...args);


async function removeBirthdayEvents() {

  const { data: events, error } = await supabase
    .from("calendar_events")
    .select("id, title, start_time, google_event_id, person_id")
    .not("person_id", "is", null);

  if (error) {
    console.error("Could not read calendar_events:", error.message);
    return { removed: 0 };
  }

  if (!events?.length) {
    log("No person-linked calendar events to convert.");
    return { removed: 0 };
  }

  const auth = await getGoogleClient();
  const calendar = google.calendar({ version: "v3", auth });

  let removed = 0;

  for (const event of events) {

    log(`removing event "${event.title}" (${event.start_time?.slice(0, 10)})`);

    if (DRY) { removed += 1; continue; }

    if (event.google_event_id) {

      try {

        await calendar.events.delete({
          calendarId: "primary",
          eventId: event.google_event_id
        });

      } catch (e) {
        // 404/410 means it's already gone from Google — deleted by hand, or a
        // previous partial run. Still worth clearing the local row.
        if (![404, 410].includes(e.code)) {
          console.error(`  Google delete failed for ${event.title}:`, e.message);
          continue;
        }
        log(`  (already absent in Google)`);
      }

    }

    const { error: delError } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", event.id);

    if (delError) {
      console.error(`  Supabase delete failed for ${event.title}:`, delError.message);
      continue;
    }

    removed += 1;

  }

  return { removed };

}


// Spread everyone who already has a check-in date so no two land on one day.
// Forward only — pulling a date earlier would shorten a cadence the user chose.
async function restaggerCheckIns() {

  const tz = await getUserTimezone();

  const { data: people, error } = await supabase
    .from("people")
    .select("id, name, check_in_days, next_check_in_at")
    .not("next_check_in_at", "is", null)
    .order("next_check_in_at", { ascending: true });

  if (error) {
    console.error("Could not read people:", error.message);
    return { moved: 0 };
  }

  const taken = new Set();

  let moved = 0;

  for (const person of people || []) {

    let date = DateTime.fromISO(person.next_check_in_at).setZone(tz);

    let key = date.toFormat("yyyy-MM-dd");

    let offset = 0;

    while (taken.has(key) && offset < 14) {
      offset += 1;
      date = date.plus({ days: 1 });
      key = date.toFormat("yyyy-MM-dd");
    }

    taken.add(key);

    if (offset === 0) {
      log(`${person.name}: ${key} — no collision, left alone`);
      continue;
    }

    log(`${person.name}: moved +${offset}d to ${key}`);

    moved += 1;

    if (DRY) continue;

    const { error: upError } = await supabase
      .from("people")
      .update({ next_check_in_at: date.toISO(), updated_at: new Date().toISOString() })
      .eq("id", person.id);

    if (upError) console.error(`  update failed for ${person.name}:`, upError.message);

  }

  return { moved };

}


const events = await removeBirthdayEvents();
const checkIns = await restaggerCheckIns();

console.log();
console.log(
  DRY
    ? `Would remove ${events.removed} calendar event(s) and move ${checkIns.moved} check-in(s). Re-run without --dry to apply.`
    : `Removed ${events.removed} calendar event(s); moved ${checkIns.moved} check-in(s).`
);
console.log(
  "Birthday reminders now appear as Google Tasks 7 days before each date, every year, created by the daily reviewIntentions cron."
);
