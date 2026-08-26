// Reading a job posting the way the owner would, in code.
//
// Everything here is pure and regex-driven on purpose. These functions decide
// what reaches his phone and what gets hidden from the feed entirely, so they
// have to return the same answer every run and be arguable line by line — the
// same rule the scorer follows (trap #4). A model in this path would be
// occasionally wrong and always confident.
//
// The governing bias: SILENCE IS NOT A NO. A posting that never names a term
// is probably an early-cycle listing that has not decided yet; a posting that
// never names a graduation year is not restricting one. Only an explicit
// statement is allowed to rule something out.


// The class the owner graduates with, and the standings that implies. He is a
// sophomore in the 2026–27 year, so for a summer 2027 internship he is a
// rising junior.
export const GRAD_YEAR = 2029;

const TARGET_SEASON = "summer";
const TARGET_YEAR = 2027;


const SEASONS = "summer|fall|autumn|winter|spring";


// "Summer 2027", "2027 Summer", "Summer '27", "Summer/Fall 2026".
function seasonYearPairs(text) {

  const out = [];

  // No \b before the year: "Summer '27" puts a space and an apostrophe
  // together, and a word boundary cannot exist between two non-word
  // characters.
  const forward = new RegExp(`\\b(${SEASONS})\\b[^.\\n]{0,12}?(20\\d{2}|'\\d{2})\\b`, "gi");
  const backward = new RegExp(`\\b(20\\d{2})\\b[^.\\n]{0,12}?\\b(${SEASONS})\\b`, "gi");

  for (const m of text.matchAll(forward)) {
    out.push({ season: m[1].toLowerCase(), year: normaliseYear(m[2]) });
  }

  for (const m of text.matchAll(backward)) {
    out.push({ season: m[2].toLowerCase(), year: normaliseYear(m[1]) });
  }

  return out;

}


function normaliseYear(raw) {
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits);
}


// Which hiring cycle a posting belongs to.
//
// Returns "summer_2027" when it says so, "other" when it names a DIFFERENT
// term, and "unspecified" when it never says. The distinction matters: an
// unnamed term is the normal state of a posting that went up in August, and
// treating it as a rejection would hide most of the season.
export function classifyTerm({ title = "", description = "" } = {}) {

  // The title is the stronger signal — a description often mentions other
  // programmes in passing ("our Summer 2026 cohort said…").
  for (const text of [title, `${title}\n${description}`.slice(0, 6000)]) {

    const pairs = seasonYearPairs(text || "");

    if (pairs.length === 0) continue;

    if (pairs.some(p => p.season === TARGET_SEASON && p.year === TARGET_YEAR)) {
      return "summer_2027";
    }

    // Named a term, and none of them was the one he wants.
    return "other";

  }

  // A bare year with no season still rules a posting in or out.
  const years = [...`${title} ${description}`.slice(0, 6000).matchAll(/\b(20\d{2})\b/g)]
    .map(m => Number(m[1]))
    .filter(y => y >= 2025 && y <= 2030);

  if (years.length > 0) {
    return years.includes(TARGET_YEAR) ? "summer_2027" : "other";
  }

  return "unspecified";

}


// Standings that exclude a rising junior, and ones that include him.
// No trailing \b on either group: "sophomores" and "graduating seniors" are
// how postings actually write it, and \b after "sophomore" cannot match a
// following "s". This exact trap has now cost three separate bugs in this
// codebase — the product terms, the no-chance list, and here. Alternatives
// that genuinely need an end anchor carry their own.
// Class standing that rules him out, stated as a requirement.
//
// "junior-status ... only" was the gap, and it is a different claim from
// "rising junior". A rising junior in summer 2027 IS him — he becomes a junior
// that autumn. Being of JUNIOR STATUS during the internship is not: Uline's
// first minimum requirement reads "This full-time, 12-week internship is open
// to Junior-status college students only", and he does not reach junior
// standing until after it ends. The posting was read in full, classified
// "unknown", and sat in the feed looking open.
const NEEDS_OLDER = /\b(rising senior|senior standing|final[- ]year|penultimate year|graduating (senior|student)|mba\b|master'?s (student|degree required)|phd|doctoral|law student|3l\b|2l\b|junior[- ]status|open to juniors?(\s+and\s+seniors?)?\s+only|juniors?\s+and\s+seniors?\s+only|must be (a |an )?(rising )?(junior|senior))/i;
const WELCOMES_HIM = /\b(rising (sophomore|junior)|sophomore|freshman|first[- ]year|underclassmen|all (undergraduate |college )?students|any (class )?year)/i;


// Whether a posting's stated eligibility admits the class of 2029.
//
// Only an explicit requirement can return "blocked". A posting that says
// nothing returns "unknown" and stays in the feed, because most postings say
// nothing and he would rather skim ten maybes than miss one real opening.
export function classifyGradFit(description = "") {

  if (!description) return "unknown";

  const text = String(description).slice(0, 20000);

  // Years stated near an eligibility word. The window is deliberately tight:
  // "graduating between December 2027 and June 2028" is a requirement,
  // "founded in 1923" is not.
  const years = new Set();

  // Anchor on the eligibility word, then read every year in the window around
  // it. Scanning for one year per anchor is what made "graduating between May
  // 2028 and December 2029" look like a 2028-only requirement.
  const anchors = /\b(?:graduat\w*|class of|degree|commencement|expected completion)\b/gi;

  for (const anchor of text.matchAll(anchors)) {

    const window = text.slice(Math.max(0, anchor.index - 60), anchor.index + 160);

    for (const m of window.matchAll(/\b(20\d{2})\b/g)) {
      const year = Number(m[1]);
      if (year >= 2025 && year <= 2032) years.add(year);
    }

  }

  if (years.size > 0) {
    // A range like "December 2027 – June 2028" lists its ends, so anything
    // between them counts as stated too.
    const low = Math.min(...years);
    const high = Math.max(...years);
    const admitted = GRAD_YEAR >= low && GRAD_YEAR <= high;
    if (admitted) return "ok";
    return "blocked";
  }

  if (WELCOMES_HIM.test(text)) return "ok";
  if (NEEDS_OLDER.test(text)) return "blocked";

  return "unknown";

}


// Coarse discipline, so whole categories can be cut rather than fought one
// title at a time. Order matters: the first match wins, and the fields he
// actually wants are checked before the ones he does not.
// Order is the whole design here, and it bit once already: "Warehouse
// Operations Supply Chain Intern" and "IT Business Analyst Internship" both
// classified as BUSINESS, because the generic business pattern matches
// "operations" and "analyst" before anything specific gets a look — and
// business is a field he wants, so both sailed into the brief.
//
// So: the three fields he actively wants first (they are specific enough to
// win outright), then every field that should be CUT, then business last as
// the catch-all it actually is.
const FIELDS = [
  // The three he wants, widened. These were too narrow before: "Product
  // Development Intern" and "Product Innovation Intern" fell through to
  // "other" — which is the same bucket quant trading and tool-and-die
  // apprenticeships land in, so hiding that bucket meant hiding good roles
  // too. Classify well first, then the cut can be clean.
  ["product",      /\b(product (manage|market|owner|intern|analy|develop|innovat|strateg|design|operations)|associate product|\bapm\b|user research|ux research|program manage)/i],
  ["marketing",    /\b(marketing|brand|advertis|campaign|creative|copywrit|social media|content|influencer|seo\b|growth|communicat|public relations|\bpr\b)/i],
  ["media",        /\b(media|editorial|journalis|newsroom|broadcast|publicity|talent relations|sponsorship|partnerships|entertainment|studio)/i],

  // Everything below is cut. Order matters: these run before the generic
  // business pattern, which would otherwise claim half of them on the word
  // "operations" or "analyst".
  ["legal",        /\b(legal|attorney|counsel|paralegal|compliance|litigation|trial)/i],
  ["supply_chain", /\b(supply chain|logistics|procurement|sourcing|warehouse|distribution|inventory|transportation|fleet|merchandis|area manager|store (executive|leadership))/i],
  ["finance",      /\b(financ|fp&a|accounting|audit|tax\b|treasury|investment|actuar|underwrit|risk (manage|advisory)|equity research|quant|trading|trader|capital markets|leasing|valuation|portfolio)/i],
  ["technical",    /\b(software|engineer|developer|data scien|data analy|analytics|machine learning|security|hardware|firmware|validation|fpga|network|\bit\b|technical|technolog|cyber|cloud|devops|systems admin|application develop|\br&d\b|research and develop|tech art|manufactur|plant intern|tool ?& ?die|\bpcba\b|maintenance|apprentice|assembl|machinist|fabricat|welder|electrician|process)/i],

  ["business",     /\b(business (develop|analy|strateg|operations)|strateg|consult|sales|account (manage|executive|coordinator)|client service|project manage|revenue|human resources|\bhr\b)/i]
];


export function classifyField(title = "") {

  for (const [name, pattern] of FIELDS) {
    if (pattern.test(title)) return name;
  }

  return "other";

}


// The disciplines he asked to cut, and ONLY those. Kept in the database, kept
// out of the feed — his words: "we can frankly cut most of these, they won't
// work well."
//
// "other" deliberately is NOT here, though it was briefly, and that mistake
// cut the feed to four postings. "Other" only means none of eight patterns
// matched the title — which is also true of "Summer 2027 Internship Program",
// exactly the broad early-career posting he most wants. An unrecognised title
// is not a rejected one.
export const HIDDEN_FIELDS = new Set(["finance", "supply_chain", "legal", "technical", "other"]);


// The disciplines worth waking his phone for. The feed can afford to be
// generous — he is scrolling it on purpose — but a notification has to be
// something he could actually get, so an alert needs a recognised field
// rather than merely surviving the cuts.
export const NOTIFY_FIELDS = new Set(["product", "marketing", "media", "business"]);


// An internship tied to a campus that is not his. "UIUC Research Park Intern"
// is a real internship and a real dead end.
const OTHER_CAMPUS = /\b(uiuc|urbana|champaign|northern illinois|\bniu\b|southern illinois|\bsiu\b|western illinois|eastern illinois|purdue|northwestern|depaul|loyola|marquette|notre dame|michigan state|ohio state|penn state|georgia tech|virginia tech|texas a&m|arizona state|byu\b|rutgers|umass|ucla|usc\b|nyu\b|mit\b|stanford|berkeley|harvard|yale|princeton|cornell|duke\b|vanderbilt|emory|tulane|baylor|clemson|auburn|alabama|tennessee|kentucky|iowa state|kansas state|oklahoma state|oregon state|washington state|colorado state|florida state|miami university|indiana university|university of (illinois|michigan|texas|florida|georgia|wisconsin|minnesota|iowa|indiana|kansas|missouri|nebraska|oklahoma|arkansas|kentucky|tennessee|alabama|maryland|virginia|arizona|utah|oregon|washington|colorado|california|chicago|pennsylvania|rochester|delaware|connecticut|vermont|maine))\b/i;

// His own school stays welcome.
const HIS_CAMPUS = /\b(illinois state|isu\b|normal, ?il|redbird)\b/i;


export function isOtherCampusProgram(title = "") {

  const text = String(title);

  if (HIS_CAMPUS.test(text)) return false;

  // The named-school list can never be complete — Louisiana State and Full
  // Sail both slipped past it. The SHAPE is the reliable signal: a posting
  // that says "on campus" and names a university is for that campus.
  if (/\bon[- ]campus\b/i.test(text) && /\b(universit|college|state\b|institute)/i.test(text)) return true;

  return OTHER_CAMPUS.test(text);

}


// Published pay, when a posting states it. Several states now require it, so
// this is populated often enough to be worth sorting by — and null stays null
// rather than becoming zero, so "unstated" never sorts as "unpaid".
export function parsePay(description = "") {

  if (!description) return { pay_min: null, pay_max: null, pay_period: null };

  const text = String(description).replace(/\s+/g, " ").slice(0, 20000);

  const num = (raw) => Number(String(raw).replace(/[,$]/g, ""));

  // "$25.00 - $32.00 per hour", "$25–$32/hr", "$70,000 to $90,000 annually"
  const range = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:-|–|—|to)\s*\$?\s?([\d,]+(?:\.\d{1,2})?)\s*(?:per\s+|\/\s?|a\s+)?(hour|hr|hourly|year|yr|annually|annum)?/i);

  if (range) {
    const min = num(range[1]);
    const max = num(range[2]);
    const period = periodOf(range[3], min);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
      return { pay_min: min, pay_max: max, pay_period: period };
    }
  }

  const single = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:per\s+|\/\s?|an?\s+)(hour|hr|hourly|year|yr|annually)/i);

  if (single) {
    const value = num(single[1]);
    if (Number.isFinite(value) && value > 0) {
      return { pay_min: value, pay_max: value, pay_period: periodOf(single[2], value) };
    }
  }

  return { pay_min: null, pay_max: null, pay_period: null };

}


function periodOf(word, amount) {
  if (word && /hour|hr/i.test(word)) return "hour";
  if (word && /year|yr|annual|annum/i.test(word)) return "year";
  // No unit given: an intern rate is two figures, a salary is five or six.
  return amount < 200 ? "hour" : "year";
}


// Comparable pay, so "$30/hr" and "$62,000/yr" can sit in one sorted list.
export function hourlyEquivalent({ pay_min, pay_period }) {
  if (pay_min == null) return null;
  if (pay_period === "year") return pay_min / 2080;
  return pay_min;
}


// When applications close, when a posting bothers to say.
//
// Greenhouse publishes this as a field; everyone else buries it in prose or
// omits it. Only unambiguous phrasings are read — a date sitting alone in a
// description is as likely to be a start date or a programme date as a
// deadline, and a wrong deadline that hides a live posting is worse than no
// deadline at all.
const DEADLINE_CUES = /\b(appl(?:y|ications?)\s+(?:by|close[sd]?|deadline|due)|deadline\s+(?:to apply|for applications?)|closing date|last day to apply|accepting applications until)\b/i;

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec";


export function parseDeadline(description = "", now = new Date()) {

  if (!description) return null;

  const text = String(description).replace(/\s+/g, " ");

  const cue = text.match(DEADLINE_CUES);

  if (!cue) return null;

  // Only look just after the cue. Widening this window is how a deadline
  // parser starts reading a programme's start date as its closing date.
  const window = text.slice(cue.index, cue.index + 120);

  // "September 19, 2026" — the day must not be the first two digits of a
  // following year. Abbott writes "Closing Date: 19 September 2026", and
  // without the negative lookahead this read "September 2026" as the 20th.
  const named = window.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, "i"));

  // "19 September 2026" — day first, which is how a lot of postings written
  // outside the US phrase it, and how Abbott phrases it anyway.
  const dayFirst = window.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?(?:,?\\s*(20\\d{2}))?`, "i"));

  // Whichever appears earlier in the window is the one the cue was pointing at.
  const first = named && dayFirst
    ? (named.index <= dayFirst.index ? "named" : "dayFirst")
    : named ? "named" : dayFirst ? "dayFirst" : null;

  if (first === "named") {
    const year = named[3] ? Number(named[3]) : inferYear(named[1], Number(named[2]), now);
    const date = new Date(Date.UTC(year, monthIndex(named[1]), Number(named[2])));
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  if (first === "dayFirst") {
    const year = dayFirst[3] ? Number(dayFirst[3]) : inferYear(dayFirst[2], Number(dayFirst[1]), now);
    const date = new Date(Date.UTC(year, monthIndex(dayFirst[2]), Number(dayFirst[1])));
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  const numeric = window.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);

  if (numeric) {
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const date = new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2])));
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  return null;

}


function monthIndex(name) {
  const list = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return list.indexOf(String(name).slice(0, 3).toLowerCase());
}


// A deadline with no year means the next time that date comes around — "apply
// by March 1" written in August is next March, not the one already past.
function inferYear(month, day, now) {

  const year = now.getUTCFullYear();

  const candidate = new Date(Date.UTC(year, monthIndex(month), day));

  // Compared against the START of today, not this instant. A deadline of
  // "August 21" read at noon on August 21 is today — the old comparison
  // pushed it a full year out, which is how a same-day deadline became 2027.
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  return candidate < startOfToday ? year + 1 : year;

}
