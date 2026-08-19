// What kind of thing is on the calendar.
//
// "You have four events today" is nearly useless. A 30-minute call with two
// other people, a two-hour solo work block, a dentist appointment and a
// birthday reminder are four completely different demands on a day, and a brief
// that lists them identically forces the reader to do the sorting the app was
// supposed to do.
//
// This is decided in code rather than by a model, on purpose. Every signal it
// needs — attendee count, duration, whether there is a location, whether it
// occupies real time — is already sitting in the calendar payload as fact. A
// model asked to infer the same thing would occasionally get it wrong and there
// would be no way to tell, whereas this is inspectable and testable. Trap #4:
// don't ask a model for something that can be computed.

export const EVENT_KINDS = ["class", "meeting", "appointment", "block", "reminder", "travel"];


// Words that decide the kind on their own, checked before anything structural.
// A "flight" with no attendees is not a focus block, and a "1:1" with no
// attendee list is still a meeting — people routinely put those on their own
// calendar without inviting anyone.
//
// The course-code pattern is first and deliberately case-sensitive: "HSC 206"
// is unambiguous, "may 100" is a sentence. Classes existed before this as
// "appointment" (a located hour) which is exactly wrong for a brief — five of
// them a day is a fixture pattern, not five separate demands, and until they
// had their own kind the brief described a Tuesday the way it would describe
// five dentist visits.
const TITLE_SIGNALS = [
  [/\b[A-Z]{2,4} ?\d{3}[A-Z]?\b/, "class"],
  [/\b(class|lecture|lab|seminar|recitation)\b/i, "class"],
  [/\b(flight|depart|arrival|drive to|train|airport|commute|travel)\b/i, "travel"],
  [/\b(1:1|one on one|standup|stand-up|sync|call with|zoom|meet with|meeting|interview|coffee with|catch up with)\b/i, "meeting"],
  [/\b(dentist|doctor|appointment|appt|haircut|dmv|checkup|clinic)\b/i, "appointment"],
  [/\b(birthday|anniversary|remember|reminder|renew|due)\b/i, "reminder"]
];


// The Google Calendar colour each kind gets when auto-colouring is on
// (lib/settings.js's auto_color_events). Names match lib/recurrence.js's
// EVENT_COLORS table. Kept as one small map so changing an association is a
// one-line edit rather than a change spread across files.
export const KIND_COLOR = {
  class: "graphite",
  meeting: "peacock",
  appointment: "banana",
  block: "basil",
  reminder: "lavender",
  travel: "grape"
};


export function classifyEvent(event = {}) {

  const title = event.title || "";

  for (const [pattern, kind] of TITLE_SIGNALS) {
    if (pattern.test(title)) return kind;
  }

  // An all-day entry does not occupy time; it marks a day. Whatever it is, it
  // is not a block of work and not a meeting you attend.
  if (event.allDay) return "reminder";

  const attendees = Number(event.attendeeCount || 0);

  // More than the organiser means other people are expecting you.
  if (attendees > 1) return "meeting";

  const minutes = durationMinutes(event);

  if (event.location && minutes <= 120) return "appointment";

  // Solo, and long enough that it is time set aside to do something rather
  // than a marker. The threshold started at 75 minutes and was wrong against
  // real data: an entire day of self-scheduled hour-long entries — packing,
  // clean room, do laundry — came back as "reminders", which is exactly the
  // undifferentiated list this file exists to prevent. An hour on the calendar
  // is a commitment of an hour.
  if (minutes >= 45) return "block";

  return "reminder";

}


export function durationMinutes(event = {}) {

  if (!event.start || !event.end) return 0;

  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;

  return Math.max(0, Math.round((end - start) / 60000));

}


// Consecutive commitments are one demand on the day, not several. Three
// classes from 9 to 12 with ten-minute walks between them is "class till noon"
// to any person describing their morning, and a brief that narrates each one
// separately reads like a calendar export. The merge is computed here, in
// code, so the model receives "one stretch of three" as fact instead of being
// asked to notice the adjacency itself.
export function clusterTimedEvents(events = [], { maxGapMinutes = 25 } = {}) {

  const timed = events
    .filter(e => !e.allDay && e.start && e.end)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const stretches = [];

  for (const event of timed) {

    const last = stretches[stretches.length - 1];

    const gapMs = last ? new Date(event.start) - new Date(last.end) : Infinity;

    if (last && gapMs <= maxGapMinutes * 60000) {

      last.events.push(event);

      // Events are sorted by start, not by end — a long event can swallow a
      // short one, so the stretch end is the furthest end seen, not the last.
      if (new Date(event.end) > new Date(last.end)) last.end = event.end;

    } else {

      stretches.push({ start: event.start, end: event.end, events: [event] });

    }

  }

  return stretches;

}


// How much of the day is actually spoken for, and where it collides. Both are
// facts a brief should state rather than a model estimate — the overlap check
// in particular is the sort of thing a model gets subtly wrong while sounding
// certain.
export function analyseDay(events = []) {

  const timed = events
    .filter(e => !e.allDay && e.start && e.end)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const committedMinutes = timed.reduce((total, e) => total + durationMinutes(e), 0);

  const overlaps = [];

  for (let i = 0; i < timed.length - 1; i++) {

    const current = timed[i];
    const next = timed[i + 1];

    if (new Date(next.start) < new Date(current.end)) {
      overlaps.push({
        first: current.title,
        second: next.title,
        // Two recurring fixtures colliding is a standing fact of the semester,
        // not news — the brief needs to know which kind of collision this is
        // so it can stop announcing the same one every morning.
        standing: (current.kind || classifyEvent(current)) === "class" &&
                  (next.kind || classifyEvent(next)) === "class"
      });
    }

  }

  const byKind = {};

  for (const event of events) {
    const kind = event.kind || classifyEvent(event);
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  return {
    committedMinutes,
    committedHours: Math.round((committedMinutes / 60) * 10) / 10,
    overlaps,
    byKind,
    stretches: clusterTimedEvents(events),
    firstStart: timed[0]?.start || null,
    // The last end is the furthest end, not the end of the last-starting
    // event — same containment case the stretch merge handles.
    lastEnd: timed.reduce((latest, e) =>
      !latest || new Date(e.end) > new Date(latest) ? e.end : latest, null)
  };

}
