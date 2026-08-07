// Turning plain words into RRULE, in one place.
//
// Google Calendar takes RFC 5545 recurrence rules. The router extracts a word
// from speech ("every week", "yearly", "every weekday"), and something has to
// map that to a rule without letting the model hand-write RRULE strings — an
// invalid rule is rejected by Google with an error that says nothing useful,
// and a subtly wrong one (BYDAY missing on a weekly rule) silently recurs on
// the wrong day forever.
//
// So the model picks from a closed set of names and this file owns the syntax.

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];


export const RECURRENCE_PATTERNS = [
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly",
  "yearly"
];


// Luxon weekday is 1=Monday..7=Sunday, which lines up with WEEKDAY_CODES.
function dayCode(date) {
  return WEEKDAY_CODES[date.weekday - 1];
}


// `start` is a Luxon DateTime — weekly and monthly rules need to know which day
// they recur on, and inferring that from the event's own start is the only
// answer that can't disagree with itself.
export function buildRecurrenceRule(pattern, start, { count = null, until = null } = {}) {

  if (!pattern) return null;

  const key = String(pattern).toLowerCase().trim();

  let rule;

  switch (key) {

    case "daily":
      rule = "FREQ=DAILY";
      break;

    // "Every weekday" is a weekly rule listing the five days, not a daily rule
    // with exceptions — the latter is what people write and it does not work.
    case "weekdays":
      rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
      break;

    case "weekly":
      rule = `FREQ=WEEKLY;BYDAY=${dayCode(start)}`;
      break;

    case "biweekly":
    case "fortnightly":
      rule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode(start)}`;
      break;

    case "monthly":
      rule = `FREQ=MONTHLY;BYMONTHDAY=${start.day}`;
      break;

    case "yearly":
    case "annually":
      rule = `FREQ=YEARLY;BYMONTH=${start.month};BYMONTHDAY=${start.day}`;
      break;

    default:
      return null;

  }

  if (count && Number.isInteger(count) && count > 0) {
    rule += `;COUNT=${count}`;
  } else if (until) {
    // RFC 5545 wants a UTC timestamp with no punctuation. Google rejects an
    // ISO string outright.
    rule += `;UNTIL=${until.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
  }

  return `RRULE:${rule}`;

}


// Google's palette, by id. Anything PersonalOS creates defaults to Tomato so
// it's identifiable at a glance against events that came from anywhere else.
export const EVENT_COLORS = {
  lavender: "1",
  sage: "2",
  grape: "3",
  flamingo: "4",
  banana: "5",
  tangerine: "6",
  peacock: "7",
  graphite: "8",
  blueberry: "9",
  basil: "10",
  tomato: "11",
  red: "11"
};

export const DEFAULT_EVENT_COLOR = "11";


export function resolveColor(color) {

  if (!color) return DEFAULT_EVENT_COLOR;

  const key = String(color).toLowerCase().trim();

  if (EVENT_COLORS[key]) return EVENT_COLORS[key];

  // Already an id.
  if (/^([1-9]|1[01])$/.test(key)) return key;

  return DEFAULT_EVENT_COLOR;

}
