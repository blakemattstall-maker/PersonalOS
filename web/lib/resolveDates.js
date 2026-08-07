import { DateTime } from "luxon";


// Pin relative dates to real ones before anything is stored.
//
// This is the fix for a bug that surfaced twice in one morning, in two
// unrelated features, from a single cause. An intention captured on 6 August
// read "Internship ends tomorrow / last day…", and that text is what gets
// stored. Everything downstream reads it later — the nudge engine the next
// morning, the brief the morning after that — and faithfully repeats the word
// "tomorrow", announcing an event that has already happened.
//
// Both consumers could be taught the capture date and told to do the
// arithmetic, and both were. But every future reader of that text would need
// the same lesson, and the one that forgets produces a confidently wrong
// statement about the user's own life. The durable fix is to never store the
// ambiguity: resolve it once, at the moment of capture, when "tomorrow"
// unambiguously means one specific day.
//
// Deliberately conservative. It rewrites only the handful of expressions whose
// meaning is fixed by the capture date, leaves everything else exactly as
// written, and never touches an expression that is already absolute.


const WEEKDAYS = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7
};


function label(date) {
  return date.toFormat("cccc d LLLL");
}


// "next friday" / "this friday" / "on friday"
function resolveWeekday(text, now) {

  return text.replace(
    /\b(next|this|on|by)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    (match, qualifier, day) => {

      const target = WEEKDAYS[day.toLowerCase()];

      let date = now.set({ weekday: target }).startOf("day");

      // "this friday" when today is Saturday means the coming one, and "next
      // friday" always means the week after the coming one.
      if (date <= now.startOf("day")) date = date.plus({ weeks: 1 });

      if (/next/i.test(qualifier)) date = date.plus({ weeks: 1 });

      return `${qualifier} ${label(date)}`;

    }
  );

}


export function resolveRelativeDates(text, { now = DateTime.now(), zone } = {}) {

  if (!text || typeof text !== "string") return text;

  const at = (zone ? now.setZone(zone) : now).startOf("day");

  let out = text;

  // Order matters: the longer phrases first, or "day after tomorrow" gets
  // half-rewritten by the "tomorrow" rule.
  const swaps = [
    [/\bthe day after tomorrow\b/gi, at.plus({ days: 2 })],
    [/\bday after tomorrow\b/gi, at.plus({ days: 2 })],
    [/\bthe day before yesterday\b/gi, at.minus({ days: 2 })],
    [/\btomorrow morning\b/gi, at.plus({ days: 1 }), (d) => `the morning of ${label(d)}`],
    [/\btomorrow night\b/gi, at.plus({ days: 1 }), (d) => `the night of ${label(d)}`],
    [/\btomorrow\b/gi, at.plus({ days: 1 })],
    [/\byesterday\b/gi, at.minus({ days: 1 })],
    [/\btonight\b/gi, at, (d) => `the night of ${label(d)}`],
    [/\bthis morning\b/gi, at, (d) => `the morning of ${label(d)}`],
    [/\btoday\b/gi, at],
    [/\bnext week\b/gi, at.plus({ weeks: 1 }), (d) => `the week of ${label(d)}`],
    [/\bthis week\b/gi, at, (d) => `the week of ${label(d)}`],
    [/\bnext month\b/gi, at.plus({ months: 1 }), (d) => `${d.toFormat("LLLL yyyy")}`],
    [/\bin (\d{1,2}) days?\b/gi, null]
  ];

  for (const [pattern, date, format] of swaps) {

    if (pattern.source.includes("(\\d{1,2}) days")) {

      out = out.replace(pattern, (m, n) => label(at.plus({ days: Number(n) })));

      continue;

    }

    out = out.replace(pattern, () => (format ? format(date) : label(date)));

  }

  return resolveWeekday(out, at);

}


// True when the text still contains a relative reference this cannot pin —
// used to decide whether a stored fact needs its capture date carried alongside
// it rather than silently trusted.
export function hasUnresolvedRelativeDate(text) {
  return /\b(soon|later|shortly|eventually|the other day|last week|a while ago)\b/i.test(text || "");
}
