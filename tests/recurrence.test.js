import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";

import { buildRecurrenceRule, resolveColor, DEFAULT_EVENT_COLOR } from "../lib/recurrence.js";


// A wrong recurrence rule is the worst kind of bug in this system: Google
// accepts it, nothing errors, and the event silently repeats on the wrong day
// forever. These pin the cases that are easy to get subtly wrong.

// A Wednesday.
const WED = DateTime.fromObject({ year: 2026, month: 8, day: 12, hour: 18 }, { zone: "America/Chicago" });


test("weekly recurrence pins the weekday of the first occurrence", () => {

  // Without BYDAY, Google infers the day from the start date anyway — but any
  // later edit to the series start silently moves every future occurrence.
  assert.equal(buildRecurrenceRule("weekly", WED), "RRULE:FREQ=WEEKLY;BYDAY=WE");

});


test("weekdays is a weekly rule over five days, not a daily rule", () => {

  // The intuitive FREQ=DAILY version fires on Saturday and Sunday too.
  assert.equal(
    buildRecurrenceRule("weekdays", WED),
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
  );

});


test("biweekly sets INTERVAL=2 and keeps the weekday", () => {

  assert.equal(
    buildRecurrenceRule("biweekly", WED),
    "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"
  );

});


test("yearly pins month and day — this is what birthdays rely on", () => {

  assert.equal(
    buildRecurrenceRule("yearly", WED),
    "RRULE:FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=12"
  );

});


test("monthly pins the day of month", () => {

  assert.equal(buildRecurrenceRule("monthly", WED), "RRULE:FREQ=MONTHLY;BYMONTHDAY=12");

});


test("a count is appended, and an unknown pattern yields no rule at all", () => {

  assert.equal(
    buildRecurrenceRule("weekly", WED, { count: 8 }),
    "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8"
  );

  // Better to create a one-off event than to send Google a rule we invented.
  assert.equal(buildRecurrenceRule("every other tuesday-ish", WED), null);
  assert.equal(buildRecurrenceRule(null, WED), null);

});


test("UNTIL is formatted as a bare UTC timestamp, which is all Google accepts", () => {

  const until = DateTime.fromISO("2026-12-31T23:59:59Z");

  const rule = buildRecurrenceRule("weekly", WED, { until });

  assert.match(rule, /;UNTIL=20261231T235959Z$/);

  // Check the UNTIL value specifically — "RRULE:" legitimately contains a
  // colon, so testing the whole string for punctuation proves nothing.
  const value = rule.match(/;UNTIL=([^;]+)$/)[1];

  assert.doesNotMatch(value, /[-:]/, "an ISO-formatted UNTIL is rejected by Google");

});


test("colours resolve by name or id, and default to red", () => {

  assert.equal(resolveColor("red"), "11");
  assert.equal(resolveColor("tomato"), "11");
  assert.equal(resolveColor("basil"), "10");
  assert.equal(resolveColor("7"), "7");

  // Out of palette range, and nonsense, both fall back rather than being sent
  // to Google as an invalid colorId.
  assert.equal(resolveColor("12"), DEFAULT_EVENT_COLOR);
  assert.equal(resolveColor("chartreuse"), DEFAULT_EVENT_COLOR);
  assert.equal(resolveColor(null), DEFAULT_EVENT_COLOR);

});


test("every pattern the model may choose actually produces a rule", async () => {

  const { RECURRENCE_PATTERNS } = await import("../lib/recurrence.js");
  const { TOOLS } = await import("../lib/toolDefinitions.js");

  const createEvent = TOOLS.find(t => t.function.name === "create_event");

  const offered = createEvent.function.parameters.properties.recurrence.enum;

  // If the tool offers the model a value this file doesn't understand, the
  // recurrence is silently dropped and the event becomes a one-off.
  for (const pattern of offered) {
    assert.ok(
      buildRecurrenceRule(pattern, WED),
      `create_event offers "${pattern}" but buildRecurrenceRule returns null for it`
    );
    assert.ok(
      RECURRENCE_PATTERNS.includes(pattern),
      `"${pattern}" is offered to the model but missing from RECURRENCE_PATTERNS`
    );
  }

});
