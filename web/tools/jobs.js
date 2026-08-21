import supabase from "../lib/supabase.js";
import { mapWithConcurrency } from "../lib/async.js";
import { logActivity } from "./activityLog.js";


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


// What counts as an internship. Deliberately generous on the way IN — a
// missed posting is the failure this exists to prevent — and the exclusions
// below are what keep it from being noise.
const INTERN_PATTERN = /\b(intern|internship|co-?op|apprentice|placement|summer analyst|university (grad|program)|early careers?)\b/i;

// Titles that match the pattern but are not what he is looking for.
const NOT_FOR_HIM = /\b(phd|doctoral|postdoc|md\b|nursing|pharmacy|internal medicine|internist)\b/i;

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
const NO_CHANCE = /\b(software|engineer|developer|programmer|\bswe\b|backend|front.?end|full.?stack|machine learning|\bml\b|\bai\b research|data scien|infrastructure|devops|\bqa\b|security\b|hardware|firmware|mechanical|electrical|chemical|civil\b|robotics|semiconductor|computer scien|fpga|asic|silicon|embedded|powertrain|battery|thermal|controls\b|validation|test engineer|manufacturing engineer|quality engineer|autonomy|perception|cad\b|plc\b)/i;

// Engineering-ADJACENT words that a marketing or product role legitimately
// carries ("Product Marketing Intern, Engineering Org"). Checked first, so an
// exclusion never eats a role that is plainly his.
const CLEARLY_HIS = /\b(marketing|brand|advertis|social media|content|communicat|public relations|creative|media plan|business develop|account (manage|executive)|product (manage|market|owner))\b/i;

const US_ANY = /\b(remote|united states|usa|new york|\bny\b|los angeles|san francisco|bay area|seattle|austin|boston|atlanta|denver|dallas|miami|washington|\bdc\b|\bca\b|\bwa\b|\btx\b|burbank|bellevue|glendale|orlando|minneapolis|philadelphia|nashville|phoenix|portland|san diego|san jose|charlotte|detroit|houston|columbus)\b/i;

// Somewhere he cannot take a summer internship. Named explicitly rather than
// inferred from "not US", because a location this app has never seen before
// is not evidence of anything — an unknown or vague location ("In-Office",
// "2 Locations") stays neutral and is still allowed to notify.
const FOREIGN = /\b(singapore|hong kong|budapest|hungary|amsterdam|netherlands|malaysia|kuala lumpur|london|united kingdom|\buk\b|england|ireland|dublin|germany|munich|berlin|hamburg|france|paris|spain|madrid|barcelona|italy|milan|rome|canada|toronto|vancouver|montreal|ottawa|australia|sydney|melbourne|india|bangalore|bengaluru|hyderabad|mumbai|japan|tokyo|china|shanghai|beijing|shenzhen|brazil|mexico|guadalajara|poland|warsaw|sweden|stockholm|denmark|copenhagen|israel|tel aviv|dubai|\buae\b|korea|seoul|taiwan|taipei|philippines|manila|thailand|bangkok|vietnam|indonesia|jakarta|costa rica|argentina|colombia|chile|peru|south africa|egypt|turkey|istanbul|switzerland|zurich|geneva|austria|vienna|belgium|brussels|norway|oslo|finland|helsinki|portugal|lisbon|czech|prague|romania|bucharest|greece|athens|new zealand|auckland|scotland|edinburgh|glasgow|wales|cardiff)\b/i;
const HOME = /\b(chicago|illinois|\bil\b|evanston|bloomington|normal|naperville|schaumburg|milwaukee|indianapolis|st\.? louis)\b/i;


// `locationPriority` decides whether home turf outranks the coasts. It is a
// setting rather than a constant because the answer changes with the year:
// this summer the plan is local, and the best roles are usually not.
export function scorePosting({ title, location }, { locationPriority = true } = {}) {

  const text = `${title || ""}`;

  const isInternship = INTERN_PATTERN.test(text) && !NOT_FOR_HIM.test(text);

  const excluded = NO_CHANCE.test(text) && !CLEARLY_HIS.test(text);

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
  if (excluded) return { isInternship, score: -99, matched, excluded: true };

  if (location) {

    // A role he cannot physically take is not a match however well the title
    // fits — Warner's Budapest CRM internship scored 7 before this.
    if (FOREIGN.test(location) && !US_ANY.test(location)) {
      score -= 5;
    } else if (locationPriority && HOME.test(location)) {
      score += 3;
    } else if (US_ANY.test(location) || HOME.test(location)) {
      score += 1;
    }

  }

  return { isInternship, score, matched, excluded: false };

}


// The bar for buzzing his phone. An internship in one of his fields clears it;
// a barista internship or an ML PhD internship does not.
const NOTIFY_SCORE = 3;


async function fetchSource(source) {

  if (source.ats === "workday") return fetchWorkday(source);
  if (source.ats === "radancy") return fetchRadancy(source);
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
        const { isInternship, score, matched } = scorePosting(p, { locationPriority });
        return {
          source_id: source.id,
          external_id: p.external_id,
          company: source.company,
          title: p.title,
          location: p.location,
          url: p.url,
          posted_at: p.posted_at,
          is_internship: isInternship,
          match_score: score,
          matched_terms: matched
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
        if (!seen.has(row.external_id) && row.is_internship && row.match_score >= NOTIFY_SCORE) {
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

  if (!result.success || result.fresh?.length === 0 || !result.fresh) {

    await logActivity({
      action: "job_check",
      input: null,
      output: { checked: result.checked || 0, failed: result.failed || 0, new: 0 },
      success: result.success !== false,
      source: "cron"
    }).catch(() => {});

    return { ...result, notified: 0 };

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
      companies: [...new Set(toTell.map(j => j.company))]
    },
    success: true,
    source: "cron"
  }).catch(() => {});

  return { ...result, notified: toTell.length };

}


// What the Jobs page reads.
export async function getJobFeed({ limit = 60, onlyInternships = true, minScore = 1 } = {}) {

  let query = supabase
    .from("job_postings")
    .select("id, company, title, location, url, posted_at, first_seen_at, match_score, is_internship, status, notified_at")
    .neq("status", "dismissed")
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (onlyInternships) query = query.eq("is_internship", true);

  // Roles he has no chance at are collected but never shown by default —
  // they score -99 (see NO_CHANCE above).
  if (minScore != null) query = query.gte("match_score", minScore);

  const { getSettings } = await import("../lib/settings.js");

  const [{ data: postings, error }, { data: sources }, settings] = await Promise.all([
    query,
    supabase.from("job_sources").select("company, ats, active, last_ok_at, last_error, consecutive_failures"),
    getSettings().catch(() => ({}))
  ]);

  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return { success: false, configured: false, postings: [], sources: [] };
    }
    throw new Error(error.message);
  }

  // Companies post the same requisition once per location, so a feed sorted by
  // arrival shows the same role three times over. Newest of each
  // company+title wins; the rest stay in the table, out of the way.
  const seenTitles = new Set();

  const deduped = (postings || []).filter(p => {
    const key = `${p.company}|${(p.title || "").toLowerCase().trim()}`;
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
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
    watching: (sources || []).filter(s => s.active).length,
    locationPriority: settings.jobs_location_priority !== false,
    broken: broken.map(s => s.company),
    lastCheckedAt: lastOk
  };

}


export async function setJobStatus({ id, status }) {

  if (!["new", "saved", "applied", "dismissed"].includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  const { error } = await supabase
    .from("job_postings")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(error.message);

  return { success: true };

}
