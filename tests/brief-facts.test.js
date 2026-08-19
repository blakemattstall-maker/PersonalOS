import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";

import { classifyEvent, analyseDay, durationMinutes, clusterTimedEvents } from "../web/lib/eventKind.js";
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


// A semester is fixtures, not appointments. Course codes are the strongest
// possible title signal and must win before anything structural — a located
// 50-minute "HSC 206" used to come back as "appointment", which made a
// Tuesday of five classes read like five dentist visits.
test("a course code makes a class, case-sensitively", () => {
  assert.equal(classifyEvent({ title: "HSC 206", start: at(8), end: at(8, 50), location: "Forker" }), "class");
  assert.equal(classifyEvent({ title: "ACC 131 Lecture", start: at(14), end: at(15) }), "class");
  // Lowercase letters next to digits are prose, not a course code.
  assert.equal(classifyEvent({ title: "may 100 pushups", start: at(9), end: at(10) }), "block");
  // The old signals still win where no course code exists.
  assert.equal(classifyEvent({ title: "Flight to Chicago", start: at(9), end: at(13) }), "travel");
});


test("back-to-back events merge into one stretch; a gap breaks it", () => {
  const stretches = clusterTimedEvents([
    { title: "HSC 206", start: at(8), end: at(8, 50) },
    { title: "ENG 128", start: at(9, 5), end: at(9, 55) },   // 15min walk — same stretch
    { title: "MGT 100", start: at(10, 10), end: at(12, 10) }, // 15min walk — same stretch
    { title: "Gym", start: at(16), end: at(17) }              // hours later — its own
  ]);

  assert.equal(stretches.length, 2);
  assert.equal(stretches[0].events.length, 3);
  assert.equal(stretches[0].start, at(8));
  assert.equal(stretches[0].end, at(12, 10));
  assert.equal(stretches[1].events.length, 1);
});


test("a long event does not lose the stretch its shorter neighbour ends inside", () => {
  const stretches = clusterTimedEvents([
    { title: "Work block", start: at(9), end: at(12) },
    { title: "Quick call", start: at(9, 30), end: at(10) }
  ]);

  assert.equal(stretches.length, 1);
  // The stretch ends when the LONG event ends, not when the last-starting one does.
  assert.equal(stretches[0].end, at(12));
});


test("two classes colliding is a standing fact; anything else is news", () => {
  const day = analyseDay([
    { title: "HSC 206", start: at(8), end: at(9) },
    { title: "ENG 128", start: at(8, 30), end: at(9, 30) },
    { title: "Dentist", start: at(9, 15), end: at(10) }
  ]);

  assert.equal(day.overlaps.length, 2);
  assert.equal(day.overlaps[0].standing, true);   // class into class
  assert.equal(day.overlaps[1].standing, false);  // class into appointment
});
