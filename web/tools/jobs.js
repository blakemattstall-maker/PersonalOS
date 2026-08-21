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

// Engineering-heavy titles he is not applying to — scored down rather than
// hidden, so a "Product Design Engineer Intern" still surfaces if it also
// scores on his fields.
const OFF_FIELD = /\b(software engineer|swe\b|backend|frontend|full.?stack|machine learning|infrastructure|devops|security engineer|hardware|firmware|mechanical|electrical|chemical)\b/i;


export function scorePosting({ title, location }) {

  const text = `${title || ""}`;

  const isInternship = INTERN_PATTERN.test(text) && !NOT_FOR_HIM.test(text);

  let score = 0;
  const matched = [];

  for (const [weight, pattern] of FIELD_TERMS) {
    const hit = text.match(pattern);
    if (hit) {
      score += weight;
      matched.push(hit[0].toLowerCase());
    }
  }

  if (OFF_FIELD.test(text)) score -= 4;

  // A US-based role is worth more than one he cannot take, but a missing
  // location is not evidence of anything — it stays neutral.
  if (location && /\b(remote|united states|usa|new york|chicago|los angeles|san francisco|seattle|austin|boston|atlanta|illinois|ny|ca|il)\b/i.test(location)) {
    score += 1;
  }

  return { isInternship, score, matched };

}


// The bar for buzzing his phone. An internship in one of his fields clears it;
// a barista internship or an ML PhD internship does not.
const NOTIFY_SCORE = 3;


async function fetchSource(source) {

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
        const { isInternship, score, matched } = scorePosting(p);
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
export async function getJobFeed({ limit = 60, onlyInternships = true } = {}) {

  let query = supabase
    .from("job_postings")
    .select("id, company, title, location, url, posted_at, first_seen_at, match_score, is_internship, status, notified_at")
    .neq("status", "dismissed")
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (onlyInternships) query = query.eq("is_internship", true);

  const [{ data: postings, error }, { data: sources }] = await Promise.all([
    query,
    supabase.from("job_sources").select("company, ats, active, last_ok_at, last_error, consecutive_failures")
  ]);

  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return { success: false, configured: false, postings: [], sources: [] };
    }
    throw new Error(error.message);
  }

  const broken = (sources || []).filter(s => s.active && s.consecutive_failures >= 3);

  const lastOk = (sources || [])
    .map(s => s.last_ok_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  return {
    success: true,
    configured: true,
    postings: postings || [],
    watching: (sources || []).filter(s => s.active).length,
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
