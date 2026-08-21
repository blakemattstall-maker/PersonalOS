import supabase from "../lib/supabase.js";
import { mapWithConcurrency } from "../lib/async.js";
import { logActivity } from "./activityLog.js";
import {
  classifyTerm, classifyGradFit, classifyField, parsePay, parseDeadline,
  HIDDEN_FIELDS, NOTIFY_FIELDS, isOtherCampusProgram
} from "../lib/jobFilters.js";


// The internship monitor.
//
// The whole value of this feature is LATENCY: postings that draw thousands of
// applicants are won by the people who apply the day they go up, so a system
// that finds one a week later has done nothing. Everything below is shaped by
// that — poll often, compare against what we have already seen, and notify the
// moment something new appears rather than on a daily digest.
//
// No paid API and no scraping. Greenhouse, Lever, Ashby and SmartRecruiters
// each publish an unauthenticated JSON board endpoint intended for exactly
// this, and between them they cover most of the watchlist. Companies on
// Workday (Disney, NBCU, EA, Netflix) have no such endpoint and are honestly
// absent rather than silently missing — see docs/schema-jobs.sql.


const ENDPOINTS = {

  greenhouse: {
    url: token => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`,
    parse: (body, company) => (body.jobs || []).map(j => ({
      external_id: String(j.id),
      title: j.title,
      location: j.location?.name || null,
      url: j.absolute_url,
      // first_published is when it went LIVE; updated_at moves whenever
      // anything is edited, so it would make an old posting look new.
      posted_at: j.first_published || j.updated_at || null,
      // The only ATS here that states it outright.
      deadline: j.application_deadline ? String(j.application_deadline).slice(0, 10) : null,
      company
    }))
  },

  lever: {
    url: token => `https://api.lever.co/v0/postings/${token}?mode=json`,
    parse: (body, company) => (Array.isArray(body) ? body : []).map(j => ({
      external_id: String(j.id),
      title: j.text,
      location: j.categories?.location || null,
      url: j.hostedUrl || j.applyUrl,
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      company
    }))
  },

  ashby: {
    url: token => `https://api.ashbyhq.com/posting-api/job-board/${token}`,
    parse: (body, company) => (body.jobs || []).map(j => ({
      external_id: String(j.id),
      title: j.title,
      location: j.location || null,
      url: j.jobUrl || j.applyUrl,
      posted_at: j.publishedAt || null,
      company
    }))
  },

  smartrecruiters: {
    url: token => `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`,
    parse: (body, company) => (body.content || []).map(j => ({
      external_id: String(j.id),
      title: j.name,
      location: [j.location?.city, j.location?.region].filter(Boolean).join(", ") || null,
      url: `https://jobs.smartrecruiters.com/${j.company?.identifier || ""}/${j.id}`,
      posted_at: j.releasedDate || null,
      company
    }))
  }

};


// Workday is its own shape: a POST, its own pagination, and no single
// endpoint that lists a board. It is also where the biggest names live —
// Disney, NBCUniversal (through Comcast), Warner Bros Discovery — so it is
// worth the extra code rather than an honest gap.
//
// The trick that makes it cheap: every Workday site exposes a `workerSubType`
// facet whose values include "Intern (Fixed Term)". Applying it server-side
// turns Warner's 373 open roles into 50 internships — three pages instead of
// nineteen — and the facet's id differs per tenant, so it is discovered on
// each poll rather than hard-coded and left to rot.
//
// `token` for a Workday source is "tenant/dc/site", e.g. "warnerbros/wd5/global".

const WORKDAY_PAGE = 20;          // Workday's own cap; larger limits return nothing.
const WORKDAY_MAX_PAGES = 5;      // 100 internships per company per poll.

function workdayParts(token) {
  const [tenant, dc, site] = String(token).split("/");
  if (!tenant || !dc || !site) throw new Error(`Malformed Workday token: ${token}`);
  return { tenant, dc, site };
}

async function workdayPost({ tenant, dc, site }, body) {

  const res = await fetch(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });

  if (!res.ok) throw new Error(`${res.status} from workday`);

  return res.json();

}

// "Posted Today" / "Posted 8 Days Ago" is all Workday gives — no timestamp.
// Approximated rather than dropped, because "posted today" is exactly the
// signal this feature exists to act on. first_seen_at remains the honest one.
function workdayPostedAt(text) {

  if (!text) return null;

  const lower = String(text).toLowerCase();

  if (lower.includes("today")) return new Date().toISOString();
  if (lower.includes("yesterday")) return new Date(Date.now() - 86400000).toISOString();

  const days = lower.match(/(\d+)\+?\s*days?\s*ago/);
  if (days) return new Date(Date.now() - Number(days[1]) * 86400000).toISOString();

  const months = lower.match(/(\d+)\+?\s*months?\s*ago/);
  if (months) return new Date(Date.now() - Number(months[1]) * 30 * 86400000).toISOString();

  return null;

}

async function fetchWorkday(source) {

  const parts = workdayParts(source.token);

  // Find this tenant's "Intern" facet value. One request, and it also tells us
  // the board is reachable before we start paging.
  const first = await workdayPost(parts, { appliedFacets: {}, limit: WORKDAY_PAGE, offset: 0, searchText: "" });

  const subType = (first.facets || []).find(f => f.facetParameter === "workerSubType");

  const internValue = (subType?.values || []).find(v => /intern/i.test(v.descriptor || ""));

  const appliedFacets = internValue ? { workerSubType: [internValue.id] } : {};

  // No intern facet on this tenant — fall back to a text search, which is
  // looser (Workday matches descriptions too) but never silently empty.
  const searchText = internValue ? "" : "intern";

  const out = [];

  for (let page = 0; page < WORKDAY_MAX_PAGES; page++) {

    // Always a fresh request: `first` was the unfiltered discovery call, so
    // its rows answer a different question than the one being paged here.
    const body = await workdayPost(parts, {
      appliedFacets,
      limit: WORKDAY_PAGE,
      offset: page * WORKDAY_PAGE,
      searchText
    });

    const postings = body.jobPostings || [];

    for (const j of postings) {
      if (!j.externalPath) continue;
      out.push({
        // externalPath is stable and unique per requisition; Workday exposes
        // no plain id in this payload.
        external_id: j.externalPath,
        title: j.title,
        location: j.locationsText || null,
        url: `https://${parts.tenant}.${parts.dc}.myworkdayjobs.com/en-US/${parts.site}${j.externalPath}`,
        posted_at: workdayPostedAt(j.postedOn),
        company: source.company
      });
    }

    if (postings.length < WORKDAY_PAGE) break;

  }

  return out;

}


// Amazon runs its own search API — public, unauthenticated, and the only one
// of the giants that answers a plain request. Apple, Microsoft, Google and
// Meta all sit behind bot protection that returns an empty body to anything
// without a browser, so they are honestly absent rather than quietly broken.
async function fetchAmazon(source) {

  const out = [];

  // 100 is the API's own page ceiling; two pages is every intern posting they
  // have open, with room to spare.
  for (let page = 0; page < 3; page++) {

    const res = await fetch(
      `https://www.amazon.jobs/en/search.json?base_query=intern&result_limit=100&offset=${page * 100}&sort=recent`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
    );

    if (!res.ok) throw new Error(`${res.status} from amazon`);

    const body = await res.json();

    const jobs = body.jobs || [];

    for (const j of jobs) {
      out.push({
        external_id: String(j.id_icims || j.id || j.job_path),
        title: j.title,
        location: j.location || j.normalized_location || null,
        url: j.job_path ? `https://www.amazon.jobs${j.job_path}` : "https://www.amazon.jobs",
        posted_at: j.posted_date || null,
        company: source.company
      });
    }

    if (jobs.length < 100) break;

  }

  return out;

}


// A community dataset rather than a company board.
//
// Apple, Microsoft, Google and Meta all answer a plain HTTP request with an
// empty body — bot protection, not a missing endpoint — so the boards this
// system can reach will never include them. SimplifyJobs maintains a public
// Summer 2027 listing set (updated daily, 14k rows) that does, and it costs
// one unauthenticated GET.
//
// Filtered hard on the way in. The dataset is overwhelmingly software and
// AI/ML — exactly the roles Blake has no chance at — so only its Product
// category, only active rows, and only the Summer 2027 term are taken.
// Everything else would be noise the scorer then has to fight.
const SIMPLIFY_URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";

const SIMPLIFY_CATEGORIES = /product/i;

async function fetchSimplify(source) {

  const res = await fetch(SIMPLIFY_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(25_000)
  });

  if (!res.ok) throw new Error(`${res.status} from simplify`);

  const rows = await res.json();

  return (rows || [])
    .filter(r =>
      r.active &&
      r.is_visible !== false &&
      SIMPLIFY_CATEGORIES.test(r.category || "") &&
      (r.terms || []).some(t => /summer\s*2027/i.test(t))
    )
    .map(r => ({
      external_id: String(r.id),
      title: r.title,
      location: (r.locations || []).join("; ") || null,
      url: r.url,
      posted_at: r.date_posted ? new Date(r.date_posted * 1000).toISOString() : null,
      // The company is the real one, not "Simplify" — this source is a
      // directory, and a posting that says Google should say Google.
      company: r.company_name || source.company
    }));

}


// Two more shapes, both found by following a company's careers URL until it
// admitted what it runs on. Neither is a job-board API in the Greenhouse
// sense; both are the private endpoint the company's own search box calls,
// and both accept a keyword server-side — so a poll costs one small request
// rather than a crawl.
//
// `token` for these is simply the careers host, e.g. "careers.rivian.com".

// Radancy (Rivian, State Farm). GET, and `keywords` narrows before we pay for
// the payload: Rivian's whole board is thousands of roles, its internships are
// six.
async function fetchRadancy(source) {

  const res = await fetch(`https://${source.token}/api/jobs?keywords=intern&limit=100`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });

  if (!res.ok) throw new Error(`${res.status} from radancy`);

  const body = await res.json();

  return (body.jobs || []).map(entry => {

    const j = entry.data || entry;

    return {
      external_id: String(j.slug || j.req_id),
      title: j.title,
      location: [j.city, j.state].filter(Boolean).join(", ") || j.location_name || null,
      url: `https://${source.token}/jobs/${j.slug || j.req_id}`,
      posted_at: j.posted_date || j.create_date || null,
      company: source.company
    };

  });

}


// Phenom People (United, Conagra). POST to the widget endpoint its own search
// page uses. The payload shape is fixed by Phenom rather than by us; `size`
// above 50 is refused by some tenants, so it pages.
const PHENOM_PAGE = 50;
const PHENOM_MAX_PAGES = 4;

async function fetchPhenom(source) {

  const out = [];

  for (let page = 0; page < PHENOM_MAX_PAGES; page++) {

    const res = await fetch(`https://${source.token}/widgets`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        lang: "en_us",
        deviceType: "desktop",
        country: "us",
        pageName: "search-results",
        ddoKey: "refineSearch",
        sortBy: "Most recent",
        subsearch: "",
        from: page * PHENOM_PAGE,
        jobs: true,
        counts: true,
        all_fields: ["country", "state", "city", "category"],
        size: PHENOM_PAGE,
        clearAll: false,
        jdsource: "facets",
        isSliderEnable: false,
        pageId: "page17",
        siteType: "external",
        keywords: "intern",
        global: true,
        selected_fields: {},
        locationData: {}
      })
    });

    if (!res.ok) throw new Error(`${res.status} from phenom`);

    const body = await res.json();

    const jobs = body.refineSearch?.data?.jobs || [];

    for (const j of jobs) {

      const id = j.reqId || j.jobId || j.jobSeqNo;

      if (!id || !j.title) continue;

      out.push({
        external_id: String(id),
        title: j.title,
        location: [j.city, j.state].filter(Boolean).join(", ") || j.cityStateCountry || null,
        url: j.applyUrl || j.jobUrl || `https://${source.token}`,
        posted_at: j.postedDate || null,
        company: source.company
      });

    }

    if (jobs.length < PHENOM_PAGE) break;

  }

  return out;

}


// The description, fetched only for postings that already look like his kind
// of internship — about 260 of the 11,000 seen. Greenhouse, Lever and Ashby
// can hand it over in the board listing; Workday needs one request per job,
// which is affordable at that count and is why this is a separate pass rather
// than part of the poll.
async function fetchDescription(source, posting) {

  try {

    if (source.ats === "workday") {
      const parts = workdayParts(source.token);
      const res = await fetch(
        `https://${parts.tenant}.${parts.dc}.myworkdayjobs.com/wday/cxs/${parts.tenant}/${parts.site}${posting.external_id}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) return null;
      const body = await res.json();
      return stripHtml(body.jobPostingInfo?.jobDescription || "");
    }

    if (source.ats === "greenhouse") {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${source.token}/jobs/${posting.external_id}`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return null;
      const body = await res.json();
      return stripHtml(body.content || "");
    }

    if (source.ats === "lever") {
      const res = await fetch(`https://api.lever.co/v0/postings/${source.token}/${posting.external_id}?mode=json`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return null;
      const body = await res.json();
      return stripHtml(body.descriptionPlain || body.description || "");
    }

    if (source.ats === "ashby") {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${source.token}?includeCompensation=true`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return null;
      const body = await res.json();
      const job = (body.jobs || []).find(j => String(j.id) === String(posting.external_id));
      return stripHtml(job?.descriptionPlain || job?.descriptionHtml || "");
    }

    if (source.ats === "radancy") {
      const res = await fetch(`https://${source.token}/api/jobs?keywords=intern&limit=100`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return null;
      const body = await res.json();
      const job = (body.jobs || []).map(e => e.data || e)
        .find(j => String(j.slug || j.req_id) === String(posting.external_id));
      return stripHtml(job?.description || "");
    }

    // Phenom hands back a teaser in the listing and nothing deeper without a
    // second widget call; the teaser is usually enough to carry a term.
    return null;

  } catch (error) {
    return null;
  }

}


function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// What counts as an internship. Deliberately generous on the way IN — a
// missed posting is the failure this exists to prevent — and the exclusions
// below are what keep it from being noise.
const INTERN_PATTERN = /\b(intern|internship|co-?op|apprentice|placement|summer analyst|university (grad|program)|early careers?)\b/i;

// Titles that match the pattern but are not what he is looking for.
// A title carrying "Master's" is a graduate programme whatever else it says —
// Conagra's "Human Resources Master's Internship" cleared every other filter.
const NOT_FOR_HIM = /\b(phd|doctoral|postdoc|md\b|mba\b|jd\b|master'?s\b|nursing|pharmacy|internal medicine|internist|graduate student)/i;

// Seniority, which INTERN_PATTERN cannot see past on its own: "Head of Early
// Career Recruiting" is a $225k full-time job that matched on the words "early
// career". Only disqualifying when the title does not ALSO say intern, so
// "Product Manager Intern" and "Marketing Manager Intern" survive.
const SENIOR_TITLE = /\b(head of|director|vice president|\bvp\b|senior|principal|staff|chief|manager of|supervisor)\b/i;
const SAYS_INTERN = /\b(intern|internship|co-?op|apprentice)\b/i;

// His fields, weighted. Scored in code, never by a model: this decides
// whether his phone buzzes, and it has to behave the same way every time.
const FIELD_TERMS = [
  // No trailing \b on the product forms: "product manage\b" cannot match
  // "Product Management", which is the single most likely title he wants.
  [4, /\b(product (manage|market|owner|analy|strateg|intern)|associate product|\bapm\b)/i],
  [4, /\b(brand|marketing|advertis|campaign|creative strateg|media plan|media buy)/i],
  [3, /\b(social media|content|copywrit|communicat|public relations|\bpr\b|influencer)/i],
  [3, /\b(business (develop|analy|strateg|operations)|strateg|consult|operations|bizops)/i],
  [2, /\b(growth|partnership|account (manage|executive|coordinator)|client service)/i],
  [2, /\b(analytic|insights|research|data analy)/i],
  [2, /\b(financ|investment|corporate development)/i]
];

// Roles with, in his words, a 0% chance: computer science and the engineering
// disciplines. These are not scored down, they are EXCLUDED — a buzz he can
// never act on is worse than silence, and a feed full of SWE internships is
// how this page would get ignored.
// No trailing \b on the group: "data scien\b" cannot match "Data Science",
// the same boundary trap the product terms hit. Alternatives that genuinely
// need an end anchor carry their own (security\b keeps "Securities Intern" —
// a finance role — from being read as a security-engineering one).
const NO_CHANCE = /\b(software|engineer|developer|programmer|\bswe\b|backend|front.?end|full.?stack|machine learning|\bml\b|\bai\b research|data scien|infrastructure|devops|\bqa\b|security\b|hardware|firmware|mechanical|electrical|chemical|civil\b|robotics|semiconductor|computer scien|fpga|asic|silicon|embedded|powertrain|battery|thermal|controls\b|validation|test engineer|manufacturing engineer|quality engineer|autonomy|perception|cad\b|plc\b|technician|assembler|machinist|fabricator|welder|electrician|millwright|maintenance tech)/i;

// Engineering-ADJACENT words that a marketing or product role legitimately
// carries ("Product Marketing Intern, Engineering Org"). Checked first, so an
// exclusion never eats a role that is plainly his.
const CLEARLY_HIS = /\b(marketing|brand|advertis|social media|content|communicat|public relations|creative|media plan|business develop|account (manage|executive)|product (manage|market|owner))\b/i;

const US_ANY = /\b(remote|united states|usa|new york|\bny\b|los angeles|san francisco|bay area|seattle|austin|boston|atlanta|denver|dallas|miami|washington|\bdc\b|\bca\b|\bwa\b|\btx\b|burbank|bellevue|glendale|orlando|minneapolis|philadelphia|nashville|phoenix|portland|san diego|san jose|charlotte|detroit|houston|columbus)\b/i;

// Somewhere he cannot take a summer internship. Named explicitly rather than
// inferred from "not US", because a location this app has never seen before
// is not evidence of anything — an unknown or vague location ("In-Office",
// "2 Locations") stays neutral and is still allowed to notify.
// Every US state, spelled out and abbreviated. This is the reliable signal:
// enumerating the world's cities is endless — Amazon alone posted internships
// in Valencia, Tarragona, Asturias, Figueres, Abruzzo, Lazio, Région Nord and
// Nova Santa Rita — while enumerating fifty states is finite and permanent.
const US_STATE = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i;

// Anchored to the END of the string, because a bare two-letter code is not
// unique to the United States: Amazon's "IT, RI, Passo Corese" is Rieti in
// Italy, and an unanchored match read it as Rhode Island and scored an Italian
// warehouse internship as a US one. A real US location ends in its state.
const US_ABBREV = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(\s+\d{5})?\s*$/;

// Values that name no place at all. These stay neutral — a posting that says
// "In-Office" or "2 Locations" is not evidence of anything, and refusing them
// would hide real roles.
const VAGUE_LOCATION = /^(\s*)(in.?office|remote|hybrid|virtual|flexible|multiple|various|\d+\s+locations?|united states|usa|us|n\/a|tbd)(\s|,|$)/i;

const FOREIGN = /\b(singapore|hong kong|budapest|hungary|amsterdam|netherlands|malaysia|kuala lumpur|london|united kingdom|\buk\b|england|ireland|dublin|germany|munich|berlin|hamburg|france|paris|spain|madrid|barcelona|italy|milan|rome|canada|toronto|vancouver|montreal|ottawa|australia|sydney|melbourne|india|bangalore|bengaluru|hyderabad|mumbai|japan|tokyo|china|shanghai|beijing|shenzhen|brazil|mexico|guadalajara|poland|warsaw|sweden|stockholm|denmark|copenhagen|israel|tel aviv|dubai|\buae\b|korea|seoul|taiwan|taipei|philippines|manila|thailand|bangkok|vietnam|indonesia|jakarta|costa rica|argentina|colombia|chile|peru|south africa|egypt|turkey|istanbul|switzerland|zurich|geneva|austria|vienna|belgium|brussels|norway|oslo|finland|helsinki|portugal|lisbon|czech|prague|romania|bucharest|greece|athens|new zealand|auckland|scotland|edinburgh|glasgow|wales|cardiff)\b/i;
const HOME = /\b(chicago|illinois|\bil\b|evanston|bloomington|normal|naperville|schaumburg|milwaukee|indianapolis|st\.? louis)\b/i;


// `locationPriority` decides whether home turf outranks the coasts. It is a
// setting rather than a constant because the answer changes with the year:
// this summer the plan is local, and the best roles are usually not.
export function scorePosting({ title, location }, { locationPriority = true } = {}) {

  const text = `${title || ""}`;

  const isInternship = INTERN_PATTERN.test(text)
    && !NOT_FOR_HIM.test(text)
    && !(SENIOR_TITLE.test(text) && !SAYS_INTERN.test(text));

  // Whole disciplines he asked to cut — finance, supply chain, legal,
  // engineering — plus internships tied to a campus that is not his. These are
  // stored but never shown or announced.
  const field = classifyField(text);

  const wrongField = HIDDEN_FIELDS.has(field) && !CLEARLY_HIS.test(text);

  const excluded = wrongField
    || isOtherCampusProgram(text)
    || (NO_CHANCE.test(text) && !CLEARLY_HIS.test(text));

  let score = 0;
  const matched = [];

  for (const [weight, pattern] of FIELD_TERMS) {
    const hit = text.match(pattern);
    if (hit) {
      score += weight;
      matched.push(hit[0].toLowerCase());
    }
  }

  // Well below any notify bar, and below the feed's default floor, so an
  // excluded role is collected but never shown or announced.
  if (excluded) return { isInternship, score: -99, matched, excluded: true, field };

  if (location) {

    const looksUS = US_STATE.test(location) || US_ABBREV.test(location) || US_ANY.test(location);
    const vague = VAGUE_LOCATION.test(location);

    // A role he cannot physically take is not a match at any score. This was
    // a -5 penalty, which a strong title outran: Barcelona scored 7 on
    // "marketing" plus "content" and stayed visible at 2.
    //
    // FOREIGN is checked first and beats the state-code allowlist, because
    // two-letter codes are not unique to the US — Lucid's "Amsterdam, NH" is
    // Noord-Holland, not New Hampshire.
    if (FOREIGN.test(location) && !US_STATE.test(location)) {
      return { isInternship, score: -99, matched, excluded: true, field };
    }

    if (!looksUS && !vague) {
      score -= 8;
    } else if (locationPriority && HOME.test(location)) {
      score += 3;
    } else if (looksUS) {
      score += 1;
    }

  }

  return { isInternship, score, matched, excluded: false, field };

}


// The bar for buzzing his phone. An internship in one of his fields clears it;
// a barista internship or an ML PhD internship does not.
const NOTIFY_SCORE = 3;


async function fetchSource(source) {

  if (source.ats === "workday") return fetchWorkday(source);
  if (source.ats === "radancy") return fetchRadancy(source);
  if (source.ats === "amazon") return fetchAmazon(source);
  if (source.ats === "simplify") return fetchSimplify(source);
  if (source.ats === "phenom") return fetchPhenom(source);

  const spec = ENDPOINTS[source.ats];

  if (!spec) throw new Error(`Unknown ATS: ${source.ats}`);

  const res = await fetch(spec.url(source.token), {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" }
  });

  if (!res.ok) throw new Error(`${res.status} from ${source.ats}`);

  return spec.parse(await res.json(), source.company);

}


// One poll of every active board.
//
// Returns the postings that are BOTH new and worth telling him about; the
// caller decides how to deliver. Everything seen is stored either way, so the
// Jobs page can show the full picture while notifications stay scarce.
export async function pollJobBoards({ concurrency = 8 } = {}) {

  const { data: sources, error } = await supabase
    .from("job_sources")
    .select("*")
    .eq("active", true);

  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return { success: false, message: "Run docs/schema-jobs.sql in Supabase first.", configured: false };
    }
    throw new Error(error.message);
  }

  if (!sources?.length) {
    return { success: true, message: "No boards on the watchlist yet.", checked: 0, fresh: [] };
  }

  // One settings read for the whole poll rather than one per posting.
  const { getSettings } = await import("../lib/settings.js");
  const locationPriority = (await getSettings().catch(() => ({}))).jobs_location_priority !== false;

  const now = new Date().toISOString();

  const fresh = [];
  let checked = 0;
  let failed = 0;

  await mapWithConcurrency(sources, async (source) => {

    let postings;

    try {

      postings = await fetchSource(source);

      checked += 1;

    } catch (fetchError) {

      failed += 1;

      // A board that has started failing must be visible as broken rather
      // than quietly contributing nothing — a renamed slug returns 404
      // forever and looks exactly like a company that stopped hiring.
      await supabase.from("job_sources").update({
        last_checked_at: now,
        last_error: fetchError.message,
        consecutive_failures: (source.consecutive_failures || 0) + 1
      }).eq("id", source.id);

      return;

    }

    const rows = postings
      .filter(p => p.external_id && p.title && p.url)
      .map(p => {
        const { isInternship, score, matched, field } = scorePosting(p, { locationPriority });
        return {
          source_id: source.id,
          external_id: p.external_id,
          // Usually the board IS the company. A directory source (Simplify)
          // carries a different employer on every row, so the posting's own
          // company wins when it has one.
          company: p.company || source.company,
          title: p.title,
          location: p.location,
          url: p.url,
          posted_at: p.posted_at,
          is_internship: isInternship,
          match_score: score,
          matched_terms: matched,
          field,
          ...(p.deadline ? { deadline: p.deadline } : {}),
          // From the title alone for now; the enrichment pass refines it once
          // the description is in hand.
          term: classifyTerm({ title: p.title })
        };
      });

    if (rows.length === 0) return;

    // Which of these have we never seen? Asked before writing, because the
    // upsert itself cannot tell us — an ON CONFLICT update returns the row
    // either way, and "new" is the entire signal this feature exists for.
    const { data: known } = await supabase
      .from("job_postings")
      .select("external_id")
      .eq("source_id", source.id)
      .in("external_id", rows.map(r => r.external_id));

    const seen = new Set((known || []).map(k => k.external_id));

    const { error: writeError } = await supabase
      .from("job_postings")
      .upsert(rows, { onConflict: "source_id,external_id", ignoreDuplicates: false });

    if (writeError) {
      console.error(`JOBS WRITE FAILED for ${source.company}:`, writeError.message);
      return;
    }

    // A board this app has never polled before would otherwise announce its
    // entire back catalogue as "new". The first poll of a source records
    // everything silently; from then on, new means new.
    const firstEverPoll = !source.last_ok_at;

    if (!firstEverPoll) {
      for (const row of rows) {
        // Term is title-only at this point; a posting that names a term he has
        // ruled out never buzzes, and one that names none still can — it is
        // usually an early listing that has not decided yet.
        // The feed shows anything that survived the cuts; a NOTIFICATION also
        // needs a recognised discipline, so an unclassifiable title can sit in
        // the list without buzzing him at 2am.
        if (!seen.has(row.external_id) &&
            row.is_internship &&
            row.match_score >= NOTIFY_SCORE &&
            row.term !== "other" &&
            NOTIFY_FIELDS.has(row.field)) {
          fresh.push(row);
        }
      }
    }

    await supabase.from("job_sources").update({
      last_checked_at: now,
      last_ok_at: now,
      last_error: null,
      consecutive_failures: 0
    }).eq("id", source.id);

  }, concurrency);

  return { success: true, checked, failed, fresh };

}


// Poll, then tell him — once per posting, ever.
export async function checkForNewJobs() {

  const result = await pollJobBoards();

  // Before the early return, not after it. This sat below and therefore only
  // ran on a poll that found something new — which is the rare case — so the
  // `enriched` figure in the log was always null and the opportunistic pass
  // never happened. The hourly job covered the backlog regardless, which is
  // exactly why it went unnoticed.
  const opportunistic = await enrichJobDetails({ limit: 40 })
    .catch(error => {
      console.error("ENRICH FAILED:", error.message);
      return { enriched: 0 };
    });

  if (!result.success || result.fresh?.length === 0 || !result.fresh) {

    await logActivity({
      action: "job_check",
      input: null,
      output: {
        checked: result.checked || 0,
        failed: result.failed || 0,
        new: 0,
        enriched: opportunistic.enriched || 0
      },
      success: result.success !== false,
      source: "cron"
    }).catch(() => {});

    return { ...result, notified: 0, enriched: opportunistic.enriched || 0 };

  }

  // Claim the notification BEFORE sending it: the same claim-then-send order
  // the Google auth alert uses, so a push failure costs one missed buzz
  // rather than a buzz per poll until it succeeds.
  const ids = result.fresh.map(f => f.external_id);

  const { data: claimed } = await supabase
    .from("job_postings")
    .update({ notified_at: new Date().toISOString() })
    .in("external_id", ids)
    .is("notified_at", null)
    .select("company, title, location, url, match_score");

  const toTell = claimed || [];

  if (toTell.length > 0) {

    const { sendPush } = await import("../lib/push.js");

    // Best first — if only one line survives the notification, it should be
    // the one he most wants to open.
    const ranked = [...toTell].sort((a, b) => b.match_score - a.match_score);

    const lead = ranked[0];

    const body = ranked.length === 1
      ? `${lead.company} — ${lead.title}${lead.location ? ` (${lead.location})` : ""}`
      : `${lead.company} — ${lead.title}, and ${ranked.length - 1} more just posted.`;

    // Deliberately NOT behind pushAllowed(): this is the one alert whose whole
    // value is arriving within the hour, and he asked for it explicitly.
    await sendPush({
      title: ranked.length === 1 ? "New internship posted" : `${ranked.length} new internships`,
      body,
      url: "/career/jobs",
      tag: `jobs-${Date.now()}`
    }).catch(error => console.error("JOB PUSH FAILED:", error.message));

    // And a prompt, so a swiped notification does not lose the listing. The
    // full set is written out because a push body holds one line.
    await supabase.from("prompts").insert([{
      kind: "digest",
      title: ranked.length === 1 ? "New internship posted" : `${ranked.length} new internships posted`,
      body: ranked
        .map(j => `${j.company} — ${j.title}${j.location ? ` (${j.location})` : ""}\n${j.url}`)
        .join("\n\n"),
      status: "pending",
      pushed_at: new Date().toISOString()
    }]).then(({ error }) => {
      if (error) console.error("JOB PROMPT FAILED:", error.message);
    });

  }

  await logActivity({
    action: "job_check",
    input: null,
    output: {
      checked: result.checked,
      failed: result.failed,
      new: toTell.length,
      enriched: opportunistic.enriched || 0,
      companies: [...new Set(toTell.map(j => j.company))]
    },
    success: true,
    source: "cron"
  }).catch(() => {});

  return { ...result, notified: toTell.length, enriched: opportunistic.enriched || 0 };

}


// Read the descriptions of postings that look like his, and decide the three
// things only a description can answer: which term it is for, whether its
// stated eligibility admits the class of 2029, and what it pays.
//
// Deliberately a separate, resumable pass rather than part of the poll. The
// poll must stay fast enough to run every fifteen minutes; this walks a few
// dozen postings at a time and remembers where it stopped, so it costs one
// fetch per requisition for the life of that requisition.
export async function enrichJobDetails({ limit = 60 } = {}) {

  const { data: pending, error } = await supabase
    .from("job_postings")
    .select("id, source_id, external_id, title, url")
    .eq("is_internship", true)
    .gte("match_score", 0)
    .is("detail_fetched_at", null)
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (error) {
    // The detail columns arrive by a later migration than the table itself.
    if (/column|schema cache/i.test(error.message)) {
      return { success: false, configured: false, message: "Run docs/schema-jobs-detail.sql in Supabase." };
    }
    throw new Error(error.message);
  }

  if (!pending?.length) return { success: true, enriched: 0 };

  const sourceIds = [...new Set(pending.map(p => p.source_id))];

  const { data: sources } = await supabase
    .from("job_sources")
    .select("id, company, ats, token")
    .in("id", sourceIds);

  const byId = new Map((sources || []).map(s => [s.id, s]));

  let enriched = 0;

  await mapWithConcurrency(pending, async (posting) => {

    const source = byId.get(posting.source_id);

    if (!source) return;

    const description = await fetchDescription(source, posting);

    const term = classifyTerm({ title: posting.title, description: description || "" });
    const gradFit = classifyGradFit(description || "");
    const pay = parsePay(description || "");
    const deadline = parseDeadline(description || "");

    const { error: writeError } = await supabase
      .from("job_postings")
      .update({
        // Trimmed: the classifiers only ever read the first several thousand
        // characters, and the raw HTML of 260 postings is not worth the rows.
        description: description ? description.slice(0, 8000) : null,
        term,
        grad_fit: gradFit,
        ...pay,
        // Never overwrite a deadline the ATS stated outright with one guessed
        // from prose.
        ...(deadline ? { deadline } : {}),
        detail_fetched_at: new Date().toISOString()
      })
      .eq("id", posting.id);

    if (writeError) console.error("ENRICH WRITE FAILED:", writeError.message);
    else enriched += 1;

  }, 6);

  return { success: true, enriched, remaining: pending.length === limit };

}


// Two things worth interrupting him about after a posting is already known:
// it is about to close, and one he applied to has gone quiet.
//
// Runs hourly alongside enrichment rather than on the fifteen-minute poll —
// neither is urgent to the minute, and an alert engine that runs four times an
// hour is one that eventually gets muted. Every posting carries its own
// cooldown, so a deadline three days out produces one nudge, not seventy.
const CLOSING_WINDOW_DAYS = 3;
const FOLLOW_UP_DAYS = 14;
const NUDGE_COOLDOWN_DAYS = 5;

export async function reviewJobDeadlines() {

  const now = new Date();

  const cooldownBefore = new Date(now.getTime() - NUDGE_COOLDOWN_DAYS * 86400000).toISOString();

  const closingBy = new Date(now.getTime() + CLOSING_WINDOW_DAYS * 86400000)
    .toISOString().slice(0, 10);

  const appliedBefore = new Date(now.getTime() - FOLLOW_UP_DAYS * 86400000).toISOString();

  const [closing, quiet] = await Promise.all([

    supabase
      .from("job_postings")
      .select("id, company, title, url, deadline, status, last_nudged_at")
      .in("status", ["new", "saved"])
      .eq("is_internship", true)
      .gte("match_score", 3)
      .not("deadline", "is", null)
      .lte("deadline", closingBy)
      .gte("deadline", now.toISOString().slice(0, 10))
      .or(`last_nudged_at.is.null,last_nudged_at.lt.${cooldownBefore}`)
      .limit(10),

    supabase
      .from("job_postings")
      .select("id, company, title, url, applied_at, last_nudged_at")
      .eq("status", "applied")
      .not("applied_at", "is", null)
      .lt("applied_at", appliedBefore)
      .or(`last_nudged_at.is.null,last_nudged_at.lt.${cooldownBefore}`)
      .limit(5)

  ]);

  // The tracking columns arrive by a later migration than the table.
  if (closing.error && /column|schema cache/i.test(closing.error.message)) {
    return { success: false, configured: false, message: "Run docs/schema-jobs-track.sql in Supabase." };
  }

  const closingRows = closing.data || [];
  const quietRows = quiet.data || [];

  if (closingRows.length === 0 && quietRows.length === 0) {
    return { success: true, closing: 0, followUps: 0 };
  }

  // Claimed before anything is sent, exactly as the new-posting alert does: a
  // failed push should cost one missed reminder, never a reminder every hour.
  const ids = [...closingRows, ...quietRows].map(r => r.id);

  await supabase
    .from("job_postings")
    .update({ last_nudged_at: now.toISOString() })
    .in("id", ids);

  const lines = [];

  for (const row of closingRows) {
    const days = Math.round((new Date(row.deadline) - now) / 86400000);
    lines.push(`Closes ${days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}: ${row.company} — ${row.title}\n${row.url}`);
  }

  for (const row of quietRows) {
    const days = Math.floor((now - new Date(row.applied_at)) / 86400000);
    lines.push(`Applied ${days} days ago, no word since: ${row.company} — ${row.title}. Worth a follow-up.\n${row.url}`);
  }

  const { sendPush } = await import("../lib/push.js");

  const title = closingRows.length > 0
    ? (closingRows.length === 1 ? "An application closes soon" : `${closingRows.length} applications close soon`)
    : "Time to follow up";

  await sendPush({
    title,
    body: lines[0].split("\n")[0],
    url: "/career/jobs",
    tag: `jobs-followup-${Date.now()}`
  }).catch(error => console.error("JOB FOLLOWUP PUSH FAILED:", error.message));

  await supabase.from("prompts").insert([{
    kind: "digest",
    title,
    body: lines.join("\n\n"),
    status: "pending",
    pushed_at: now.toISOString()
  }]);

  return { success: true, closing: closingRows.length, followUps: quietRows.length };

}


// What the Jobs page reads.
export async function getJobFeed({ limit = 120, onlyInternships = true, minScore = 1 } = {}) {

  let query = supabase
    .from("job_postings")
    .select("id, company, title, location, url, posted_at, first_seen_at, match_score, is_internship, status, notified_at, term, grad_fit, pay_min, pay_max, pay_period, field, deadline, applied_at")
    .neq("status", "dismissed")
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (onlyInternships) query = query.eq("is_internship", true);

  // Roles he has no chance at are collected but never shown by default —
  // they score -99 (see NO_CHANCE above).
  if (minScore != null) query = query.gte("match_score", minScore);

  const { getSettings } = await import("../lib/settings.js");

  let [{ data: postings, error }, { data: sources }, settings] = await Promise.all([
    query,
    supabase.from("job_sources").select("company, ats, active, last_ok_at, last_error, consecutive_failures"),
    getSettings().catch(() => ({}))
  ]);

  // The detail columns arrive by a later migration; without them the feed
  // still works, it just cannot narrow by term or eligibility.
  let detailed = true;

  if (error && /column|schema cache/i.test(error.message)) {

    detailed = false;

    const fallback = await supabase
      .from("job_postings")
      .select("id, company, title, location, url, posted_at, first_seen_at, match_score, is_internship, status, notified_at")
      .neq("status", "dismissed")
      .eq("is_internship", true)
      .gte("match_score", minScore)
      .order("first_seen_at", { ascending: false })
      .limit(limit);

    if (fallback.error && /schema cache|does not exist/i.test(fallback.error.message)) {
      return { success: false, configured: false, postings: [], sources: [] };
    }

    postings = fallback.data || [];
    error = null;

  }

  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return { success: false, configured: false, postings: [], sources: [] };
    }
    throw new Error(error.message);
  }

  // Summer 2027 or not yet stated — never a term he has ruled out, and never a
  // posting whose own eligibility rules him out.
  if (detailed) {
    postings = (postings || []).filter(p =>
      (p.term == null || p.term === "summer_2027" || p.term === "unspecified") &&
      p.grad_fit !== "blocked"
    );
  }

  // Companies post the same requisition once per location, so a feed sorted by
  // arrival shows the same role three times over. Newest of each
  // company+title wins; the rest stay in the table, out of the way.
  const seenTitles = new Set();
  const perCompany = new Map();

  const deduped = (postings || []).filter(p => {

    const key = `${p.company}|${(p.title || "").toLowerCase().trim()}`;

    if (seenTitles.has(key)) return false;

    seenTitles.add(key);

    // And no single company may own the page. Amazon alone posts a hundred
    // operations internships; six of them is a fair sample, sixty is a wall
    // that hides every other company on the watchlist.
    const count = (perCompany.get(p.company) || 0) + 1;

    perCompany.set(p.company, count);

    return count <= 6;

  });

  const broken = (sources || []).filter(s => s.active && s.consecutive_failures >= 3);

  const lastOk = (sources || [])
    .map(s => s.last_ok_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  return {
    success: true,
    configured: true,
    postings: deduped,
    detailed,
    watching: (sources || []).filter(s => s.active).length,
    locationPriority: settings.jobs_location_priority !== false,
    broken: broken.map(s => s.company),
    lastCheckedAt: lastOk
  };

}


// What the morning brief needs to know about the search.
//
// The monitor polls 183 boards every fifteen minutes and, until now, the one
// thing read every morning had no idea it existed. A posting he has not opened
// yet, and a deadline about to pass, are exactly the kind of fact a brief is
// for — and unlike a push at 3am, the brief arrives when he can act.
export async function briefJobFacts({ hours = 24 } = {}) {

  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("job_postings")
    .select("company, title, location, first_seen_at, deadline, status, match_score, term, grad_fit, field")
    .eq("is_internship", true)
    .gte("match_score", 3)
    .neq("status", "dismissed")
    .order("first_seen_at", { ascending: false })
    .limit(200);

  if (error) {
    // A missing table or column must cost the jobs LINE, never the brief.
    console.error("BRIEF JOB FACTS UNAVAILABLE:", error.message);
    return null;
  }

  const usable = (data || []).filter(r =>
    (r.term == null || r.term === "summer_2027" || r.term === "unspecified") &&
    r.grad_fit !== "blocked" &&
    NOTIFY_FIELDS.has(r.field)
  );

  const fresh = usable.filter(r => r.first_seen_at >= since);

  const closing = usable.filter(r =>
    r.deadline && r.deadline <= soon && r.status !== "applied"
  );

  const openApplications = (data || []).filter(r => r.status === "applied").length;

  if (fresh.length === 0 && closing.length === 0) return null;

  return {
    fresh: fresh.slice(0, 5).map(r => ({
      company: r.company,
      title: r.title,
      location: r.location
    })),
    freshCount: fresh.length,
    closing: closing.slice(0, 3).map(r => ({
      company: r.company,
      title: r.title,
      deadline: r.deadline
    })),
    openApplications
  };

}


export async function setJobStatus({ id, status }) {

  if (!["new", "saved", "applied", "dismissed"].includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  const patch = { status };

  // The status column records THAT he applied; this records when, which is
  // what makes a two-week silence noticeable.
  if (status === "applied") patch.applied_at = new Date().toISOString();

  const { error } = await supabase
    .from("job_postings")
    .update(patch)
    .eq("id", id);

  if (error) throw new Error(error.message);

  return { success: true };

}
