import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";

import { classifyEvent, analyseDay, durationMinutes } from "../web/lib/eventKind.js";
import { resolveRelativeDates } from "../web/lib/resolveDates.js";


// Everything the brief states as fact is computed here rather than by a model,
// because a model that does its own arithmetic is occasionally wrong and always
// sounds certain. That only holds if the arithmetic is actually right.


const at = (h, m = 0) => DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: h, minute: m }).toISO();


test("a calendar entry with other people on it is a meeting", () => {
  assert.equal(classifyEvent({ title: "Swap cars", start: at(16), end: at(17), attendeeCount: 4 }), "meeting");
});


test("an hour set aside alone is a block, not a reminder", () => {
  // The threshold was 75 minutes and classified a whole day of real hour-long
  // entries — packing, clean room, laundry — as reminders.
  assert.equal(classifyEvent({ title: "Clean room", start: at(12), end: at(13), attendeeCount: 0 }), "block");
});


test("an all-day entry is never a block", () => {
  assert.equal(classifyEvent({ title: "Allison's birthday", allDay: true }), "reminder");
});


test("the title decides when it is unambiguous, even with no attendees", () => {
  assert.equal(classifyEvent({ title: "Flight to Chicago", start: at(9), end: at(13) }), "travel");
  assert.equal(classifyEvent({ title: "1:1 with Jon", start: at(9), end: at(9, 30) }), "meeting");
  assert.equal(classifyEvent({ title: "Dentist", start: at(9), end: at(10) }), "appointment");
});


test("overlaps are found, not estimated", () => {
  const day = analyseDay([
    { title: "Clean car", start: at(16, 20), end: at(17, 20) },
    { title: "Swap cars", start: at(16, 30), end: at(17, 30) },
    { title: "Return rental", start: at(17, 40), end: at(18, 40) }
  ]);

  assert.equal(day.overlaps.length, 1);
  assert.equal(day.overlaps[0].first, "Clean car");
  assert.equal(day.overlaps[0].second, "Swap cars");
  assert.equal(day.committedHours, 3);
});


test("an all-day entry does not count as committed time", () => {
  const day = analyseDay([
    { title: "Birthday", allDay: true },
    { title: "Work", start: at(9), end: at(10) }
  ]);
  assert.equal(day.committedHours, 1);
});


test("duration survives a missing or malformed end", () => {
  assert.equal(durationMinutes({ start: at(9) }), 0);
  assert.equal(durationMinutes({}), 0);
});


// The bug this whole area exists for: an intention captured on the 6th saying
// "ends tomorrow" was still being read as "tomorrow" on the 7th.
test("relative dates are pinned to the day they were captured", () => {
  const captured = DateTime.fromISO("2026-08-06T09:00", { zone: "America/Chicago" });

  const out = resolveRelativeDates("Internship ends tomorrow / last day", { now: captured });

  assert.match(out, /Friday 7 August/);
  assert.doesNotMatch(out, /tomorrow/i);
});


test("text with no relative date is left exactly alone", () => {
  const captured = DateTime.fromISO("2026-08-06T09:00");

  for (const text of ["Keep a 4.0 through sophomore year.", "Be 190 lbs before winter ends."]) {
    assert.equal(resolveRelativeDates(text, { now: captured }), text);
  }
});


test("the longer phrase wins over the shorter one inside it", () => {
  const captured = DateTime.fromISO("2026-08-06T09:00");

  const out = resolveRelativeDates("ship it the day after tomorrow", { now: captured });

  assert.match(out, /Saturday 8 August/);
  assert.doesNotMatch(out, /tomorrow/i);
});
