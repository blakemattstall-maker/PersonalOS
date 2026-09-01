import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { scorePosting } from "../web/tools/jobs.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


// ---------------------------------------------------------------------------
// The internship monitor. Its entire value is latency — a posting that draws
// thousands of applicants is won by whoever applies the day it goes up — so
// what matters is that it never misses one it should catch, and never cries
// wolf often enough to get muted.
// ---------------------------------------------------------------------------


test("an internship in his fields clears the notify bar", () => {

  for (const title of [
    "Product Management Intern, Summer 2027",
    "Marketing Intern",
    "Brand Strategy Intern",
    "Summer 2027 Intern - Social Media & Content",
    "Business Analyst Intern",
    "Communications Internship"
  ]) {
    const { isInternship, score } = scorePosting({ title, location: "Chicago, IL" });
    assert.ok(isInternship, `${title} must read as an internship`);
    assert.ok(score >= 3, `${title} scored ${score} — under the notify bar`);
  }

});


test("the Riot posting he already knows about would fire", () => {

  // The agreed proof of concept: Riot's summer internships drop Sept 1. Their
  // Greenhouse board was verified live, so the only question is whether the
  // scorer would let one through.
  const { isInternship, score, matched } = scorePosting({
    title: "Product Manager Intern, Summer 2027",
    location: "Los Angeles, USA"
  });

  assert.equal(isInternship, true);
  assert.ok(score >= 3, `scored ${score}`);
  assert.ok(matched.length > 0);

});


test("things that are not his internships stay quiet", () => {

  // A full-time role is not an internship, however well it matches.
  assert.equal(scorePosting({ title: "Senior Product Manager" }).isInternship, false);

  // The pattern catches these, and the exclusions are what stop them buzzing.
  assert.equal(scorePosting({ title: "PhD Research Intern, Machine Learning" }).isInternship, false);
  assert.equal(scorePosting({ title: "Nursing Intern" }).isInternship, false);

  // An engineering internship is a real internship but not his field — kept in
  // the feed, scored under the notify bar.
  const swe = scorePosting({ title: "Software Engineer Intern", location: "Remote" });
  assert.equal(swe.isInternship, true);
  assert.ok(swe.score < 3, `SWE intern scored ${swe.score} — it would have buzzed`);

});


test("a hybrid title still surfaces when it matches his side of the work", () => {

  // "Product Design Engineer Intern" carries the off-field penalty AND product
  // credit; the point of scoring rather than filtering is that it survives.
  const { isInternship, score } = scorePosting({
    title: "Product Marketing Intern, Software Engineering Org",
    location: "New York"
  });

  assert.equal(isInternship, true);
  assert.ok(score >= 3, `scored ${score}`);

});


test("nothing about the score depends on a model", () => {

  const source = read("web/tools/jobs.js");

  // This decides whether his phone buzzes; it has to behave identically every
  // run, which a model cannot promise (trap #4).
  assert.doesNotMatch(source, /openai|chat\.completions/i);

});


test("a posting is announced at most once, and the claim precedes the push", () => {

  const source = read("web/tools/jobs.js");

  // Claim-then-send: a push failure costs one missed buzz rather than a buzz
  // per poll forever. Same order the Google auth alert uses.
  const check = source.slice(source.indexOf("export async function checkForNewJobs"));

  const claim = check.indexOf("notified_at: new Date().toISOString()");
  const push = check.indexOf("sendPush(");

  assert.ok(claim > 0 && claim < push, "notified_at must be claimed before the push");
  assert.match(check, /\.is\("notified_at", null\)/, "and only rows never announced may be claimed");

});


test("a board's first ever poll announces nothing", () => {

  // Otherwise adding a company to the watchlist would fire its entire back
  // catalogue at his phone.
  const source = read("web/tools/jobs.js");

  assert.match(source, /firstEverPoll = !source\.last_ok_at/);
  assert.match(source, /if \(!firstEverPoll\)/);

});


test("a board that starts failing is visible, not silently empty", () => {

  const source = read("web/tools/jobs.js");

  assert.match(source, /consecutive_failures/);
  assert.match(source, /last_error: fetchError\.message/);

  // And the page says so.
  assert.match(read("web/app/JobsView.js"), /Not responding/);

});


test("Career holds two pages, not one scroll", () => {

  const nav = read("web/app/CareerNav.js");
  assert.match(nav, /\/career\/money/);
  assert.match(nav, /\/career\/jobs/);

  // Distinct routes, each with its own loading state.
  for (const file of [
    "web/app/career/money/page.js",
    "web/app/career/jobs/page.js",
    "web/app/career/money/loading.js",
    "web/app/career/jobs/loading.js"
  ]) {
    assert.ok(read(file).length > 0, `${file} must exist`);
  }

  // Old links keep working.
  assert.match(read("web/app/money/page.js"), /redirect\("\/career\/money"\)/);
  assert.match(read("web/app/career/page.js"), /redirect\("\/career\/money"\)/);

  const tabs = read("web/app/TabBar.js");
  const order = [...tabs.matchAll(/label: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ["Today", "Health", "Career", "People", "News", "Settings"]);

});


test("the poller has a clock that is not a daily cron", () => {

  // The clock moved. Vercel's free crons fire once a day, which is useless for
  // "apply the day it posts", so this lived on GitHub Actions — and then
  // pg_cron was adopted because GitHub throttles a */15 schedule on a free
  // public repo down to roughly 18-30 runs a day. Both kept running, so the
  // most expensive invocation in the system was being made twice for one
  // result. pg_cron owns the cadence now; the workflow is a canary.
  //
  // Asserted against whichever file actually carries the schedule, which is the
  // point of the test — not against the file that used to.
  const schedule = read("docs/cron-jobs.sql");

  assert.match(schedule, /'\*\/15 \* \* \* \*'/, "the 15-minute poll is the whole feature");
  assert.match(schedule, /api\/cron\/checkJobs/);

});


test("the external liveness alarm on the poller still exists", () => {

  // Demoting the workflow to a canary must not become deleting it. This is the
  // only alarm anywhere that fires from OUTSIDE the app when the poller stops
  // answering — pg_cron failing silently is exactly the case it catches, and
  // pg_cron cannot report on itself.
  const workflow = read(".github/workflows/job-poll.yml");

  assert.match(workflow, /api\/cron\/checkJobs/);
  assert.match(workflow, /secrets\.CRON_SECRET/);

  // A failed poll must fail the workflow, or a dead endpoint reads as a quiet
  // hiring market for weeks.
  assert.match(workflow, /test "\$code" = "200"/);

  // Still on a clock of its own, just not a duplicate of the real one.
  const cron = workflow.match(/- cron: "([^"]+)"/);

  assert.ok(cron, "the canary needs a schedule or it never fires");

  assert.notEqual(cron[1], "*/15 * * * *",
    "a canary on the same cadence as pg_cron is not a canary, it is a second poller");

});


test("every input is at least 16px, or iOS zooms the page on focus", () => {

  // Mobile Safari zooms whenever a focused input's font-size is under 16px —
  // which is what made tapping the menu search box shift the whole page.
  // field() is the one place that decides this.
  assert.match(read("web/app/ui.js"), /export function field[\s\S]{0,200}text-base/);

  for (const file of ["web/app/DiningMenu.js", "web/app/SettingsPanel.js"]) {
    const source = read(file);
    const inputs = [...source.matchAll(/<input[\s\S]{0,400}?\/>/g)].map(m => m[0]);
    for (const input of inputs) {
      assert.doesNotMatch(input, /className="[^"]*\btext-sm\b/, `${file} has a sub-16px input`);
    }
  }

});


test("a page is always at least a screen tall, so the fixed tab bar cannot drift", () => {

  // A short loading skeleton made the document unscrollable mid-navigation,
  // which expands mobile Safari's toolbar, shrinks the visual viewport and
  // lifts anything anchored to the bottom of it.
  assert.match(read("web/app/ui.js"), /min-h-\[100svh\]/);

});


test("roles he has no chance at never reach him", () => {

  // His words: CS and most engineering are 0%. These are excluded outright
  // rather than ranked low — a buzz he can never act on is worse than silence.
  for (const title of [
    "Software Engineer Intern",
    "Machine Learning Intern",
    "Data Science Intern",
    "Security Engineering Intern",
    "Mechanical Engineering Co-op"
  ]) {
    const { score, excluded } = scorePosting({ title, location: "Chicago, IL" });
    assert.equal(excluded, true, `${title} should be excluded`);
    assert.ok(score < 0, `${title} scored ${score}`);
  }

  // But a marketing role does not become an engineering role by naming one.
  const hybrid = scorePosting({ title: "Product Marketing Intern, Engineering Org", location: "Chicago, IL" });
  assert.equal(hybrid.excluded, false);
  assert.ok(hybrid.score >= 3);

});


test("a role he cannot physically take does not buzz", () => {

  // Warner's Budapest CRM internship scored 7 on title alone before this.
  const abroad = scorePosting({ title: "CRM Campaign Operations Intern", location: "Budapest Szabadsag Ter" });
  assert.ok(abroad.score < 3, `Budapest scored ${abroad.score}`);

  assert.ok(scorePosting({ title: "Market Research Strategy Intern", location: "Singapore" }).score < 3);

  // An unknown or vague location is not evidence of anything and stays
  // eligible — "In-Office" and "2 Locations" are real values on live boards.
  assert.ok(scorePosting({ title: "Marketing Events Intern", location: "In-Office" }).score >= 3);
  assert.ok(scorePosting({ title: "Marketing Events Intern", location: null }).score >= 3);

});


test("the location switch changes ranking, never collection", () => {

  const chicago = { title: "Marketing Intern", location: "Chicago, IL" };
  const seattle = { title: "Marketing Intern", location: "Seattle, WA" };

  // On: home turf outranks the coasts.
  assert.ok(
    scorePosting(chicago, { locationPriority: true }).score >
    scorePosting(seattle, { locationPriority: true }).score
  );

  // Off: every US location is weighed the same, so the best roles — which are
  // usually not in Illinois — stop being quietly ranked down.
  assert.equal(
    scorePosting(chicago, { locationPriority: false }).score,
    scorePosting(seattle, { locationPriority: false }).score
  );

  // Either way both are still internships worth collecting.
  assert.equal(scorePosting(seattle, { locationPriority: true }).isInternship, true);

});


test("Workday is polled by its intern facet, not by brute pagination", () => {

  const source = read("web/tools/jobs.js");

  // Every Workday site exposes a workerSubType facet including "Intern (Fixed
  // Term)". Applying it turns Warner's 373 roles into 50 — three pages instead
  // of nineteen — and the facet id differs per tenant, so it must be
  // discovered per poll rather than hard-coded.
  assert.match(source, /workerSubType/);
  assert.match(source, /\/intern\/i\.test\(v\.descriptor/);
  assert.match(source, /WORKDAY_PAGE = 20/, "Workday returns nothing for larger limits");

  // A tenant without the facet must still work rather than silently return
  // nothing.
  assert.match(source, /searchText = internValue \? "" : "intern"/);

});


test("the feed hides the same requisition posted per-location", () => {

  assert.match(read("web/tools/jobs.js"), /seenTitles/);

});


test("a scheduler that stops firing is visible, not silent", () => {

  // The failure that motivated this: GitHub Actions registered the schedule,
  // reported it active, and then never ran it for over an hour. Nothing in the
  // app would have said so — a dead clock and a quiet hiring market look
  // identical from the feed.
  // The threshold moved to the server when the client version was found to be
  // reading the clock during a render — impure, because React may re-render at
  // any moment and get a different answer. The warning still renders in the
  // view; only the decision moved.
  const page = read("web/app/career/jobs/page.js");
  const view = read("web/app/JobsView.js");

  assert.match(page, /2 \* 60 \* 60 \* 1000/, "two hours is four missed polls");
  assert.match(page, /stale=\{feed\.stale\}/, "and it has to reach the view");
  assert.match(view, /No poll has completed in over two hours/);

  // Read outside the component, not merely outside the JSX: a Server Component
  // renders once per request so either would be correct, but the rule is that a
  // component is a pure function of what it was handed.
  assert.match(page, /async function getFeed\(\)/);

  // And there is a scheduler that actually keeps time, alongside the flaky one.
  const cron = read("docs/cron-jobs.sql");
  assert.match(cron, /pg_cron/);
  assert.match(cron, /\*\/15 \* \* \* \*/);
  assert.match(cron, /api\/cron\/checkJobs/);

  // The secret must never be committed — the file ships a placeholder.
  assert.match(cron, /PUT_YOUR_CRON_SECRET_HERE/);

});


// ---------------------------------------------------------------------------
// The weekly digest, which was neither weekly nor a digest
// ---------------------------------------------------------------------------

// It rides the hourly enrichJobs slot rather than owning a cron, and the only
// thing standing between that and a notification every hour was `weekday !== 7`
// — a condition that is true for twenty-four consecutive hours. It sent
// SEVENTEEN copies of the same digest in one Sunday: a buzz on the hour, and
// seventeen identical cards stacked behind them on the dashboard.
//
// Everything else in this file already claims before it sends. This is the one
// that had nothing to claim.


function digestBody() {
  const jobs = read("web/tools/jobs.js");
  const start = jobs.indexOf("export async function weeklyJobDigest");
  assert.ok(start !== -1, "weeklyJobDigest is gone");
  const after = jobs.slice(start + 40);
  const next = after.search(/\nexport (async )?function /);
  return next === -1 ? after : after.slice(0, next);
}


test("a once-a-week alert on an hourly clock claims the week first", () => {

  const digest = digestBody();

  // Being Sunday is not enough — it has to not have gone out already.
  assert.match(
    digest,
    /\.eq\("action", "jobs_weekly_digest"\)/,
    "the digest must look up whether it has already been sent"
  );

  assert.match(
    digest,
    /days < 6/,
    "and refuse to send again inside the same week"
  );

});


test("the claim is written before anything is sent, and a failed claim sends nothing", () => {

  const digest = digestBody();

  const claim = digest.indexOf('action: "jobs_weekly_digest"');
  const card = digest.indexOf('from("prompts").insert');
  const push = digest.indexOf("sendPush({");

  assert.ok(claim > 0 && card > 0 && push > 0, "could not find all three steps");

  assert.ok(claim < card, "the week must be claimed before the dashboard card is written");
  assert.ok(claim < push, "the week must be claimed before the push goes out");

  // A swallowed claim is worse than no claim: the digest goes out and leaves
  // nothing behind to say so, and the next hourly run sends it again — which
  // is precisely the bug.
  assert.ok(
    !/action: "jobs_weekly_digest"[\s\S]{0,400}\}\)\.catch\(\(\) => \{\}\)/.test(digest),
    "the claim must not be written with a swallowing catch"
  );

  assert.match(digest, /could not claim the week's digest/,
    "and a claim that fails has to abort the send");

});


test("the digest lands at a readable hour rather than the first slot after midnight", () => {

  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /const DIGEST_HOUR = \d+/);

  const hour = Number(jobs.match(/const DIGEST_HOUR = (\d+)/)[1]);

  assert.ok(hour >= 7 && hour <= 12, `a weekly digest at ${hour}:00 is not a morning digest`);

  // A floor, not an equality: a missed 9am run must still send at 10, rather
  // than skipping the week because one cron tick was late.
  assert.match(digestBody(), /now\.hour < DIGEST_HOUR/);

});


test("force still bypasses every guard, so the digest can be tested on any day", () => {

  const digest = digestBody();

  for (const guard of [/!force && now\.weekday/, /!force && now\.hour/, /!force && sent\?\.\[0\]/]) {
    assert.match(digest, guard, "every guard has to be escapable with force");
  }

});


// ---------------------------------------------------------------------------
// The platform's sixty seconds
// ---------------------------------------------------------------------------

// Twice on the night of 29 August the GitHub step ran from 02:45:46 to
// 02:46:46 — exactly sixty seconds — and Vercel killed the function. Two things
// went wrong at once, and the second is the worse one: the workflow went red,
// AND the poll never reached its logActivity call, so nothing recorded that a
// poll had been attempted at all. Loud where it did not matter, silent where it
// did. The poll normally finishes 182 boards in 25 seconds; one slow patch of
// boards at 15 seconds a fetch is enough to double that.

test("the poll stops on its own terms before the platform stops it", () => {

  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /const POLL_BUDGET_MS = [\d_]+/);

  const budget = Number(jobs.match(/const POLL_BUDGET_MS = ([\d_]+)/)[1].replace(/_/g, ""));

  // Room left for the alert path, the enrichment and the log that all run
  // after the poll — every one of which is worth more than the last few boards.
  assert.ok(budget >= 20_000, `a ${budget}ms budget gives up too easily`);
  assert.ok(budget <= 45_000, `a ${budget}ms budget leaves nothing for the work after the poll`);

});


test("running out of time is recorded, not silently indistinguishable from a quiet market", () => {

  const jobs = read("web/tools/jobs.js");

  const poll = jobs.slice(jobs.indexOf("export async function pollJobBoards"));

  // Checked per source, not per batch: the queue is already running when the
  // clock runs out, and everything still waiting should cost nothing.
  assert.match(poll.slice(0, 4000), /if \(Date\.now\(\) > deadline\) \{\s*\n\s*skipped \+= 1;/);

  // Bounded at the next declaration rather than a guessed character count —
  // the return sits 7,000 characters in, and a slice(0, 6000) silently missed
  // it while looking like a real assertion.
  const body = poll.slice(0, poll.search(/\nexport (async )?function /) === -1
    ? poll.length
    : poll.search(/\nexport (async )?function /));

  assert.match(body, /return \{ success: true, checked, failed, skipped, fresh \}/,
    "the caller has to be able to see it");

  assert.match(jobs, /\.\.\.\(result\.skipped \? \{ skipped: result\.skipped \} : \{\}\)/,
    "and it has to reach the activity log, or the diagnostics panel cannot tell");

});


test("a late poll does not then spend its remaining seconds enriching", () => {

  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /enrichJobDetails\(\{ limit: result\.skipped \? \d+ : \d+ \}\)/,
    "the hourly enrichment job drains the backlog anyway");

});


test("the 11 MB Simplify dataset is only parsed when it has changed", () => {

  // Measured: 11,192,190 bytes and 14,915 rows, re-downloaded and re-parsed on
  // every poll — 113 times a day — to keep about sixty rows. The download is
  // I/O and largely unbilled; inflating and parsing eleven megabytes is real
  // active CPU, and collecting fifteen thousand discarded objects after it is
  // more. It is a file in a git repo, it serves an ETag, and the code's own
  // comment says it updates daily.
  const jobs = read("web/tools/jobs.js");

  const simplify = jobs.slice(
    jobs.indexOf("async function fetchSimplify"),
    jobs.indexOf("async function fetchSimplify") + 2200
  );

  assert.match(simplify, /"if-none-match": seen/);
  assert.match(simplify, /if \(res\.status === 304\) return \[\]/,
    "an unchanged dataset is the conclusion a full parse would have reached — not a failure");

  // Stored after the parse, or a truncated download poisons the cache and the
  // board goes quiet until the file next changes.
  const parseAt = simplify.indexOf("await res.json()");
  const storeAt = simplify.indexOf('setSetting("simplify_etag"');

  assert.ok(parseAt > 0 && storeAt > parseAt,
    "the etag must only be stored once the body actually parsed");

});


test("a board that answered with nothing is still a successful poll", () => {

  // This mattered the moment the Simplify conditional request shipped: a 304
  // means "nothing changed" and yields an empty array BY DESIGN, so the common
  // case for that board is now zero postings. A bare `return` there skips the
  // last_ok_at stamp at the bottom of the function, and a board polling
  // perfectly every fifteen minutes starts reading as one that has not answered
  // since the file last changed — the Jobs page raises its stale-poll warning
  // and the health check counts it dead.
  const jobs = read("web/tools/jobs.js");

  const empty = jobs.slice(
    jobs.indexOf("if (usable.length === 0)"),
    jobs.indexOf("if (usable.length === 0)") + 700
  );

  assert.match(empty, /last_ok_at: now/, "an empty poll must still record that the board answered");
  assert.match(empty, /consecutive_failures: 0/, "and must not accumulate failures");

});


// ---------------------------------------------------------------------------
// Searching, grouping, and roles the crawler will never see
// ---------------------------------------------------------------------------

test("search matches across company, title and city, and narrows on every term", () => {

  const view = read("web/app/JobsView.js");

  // He thinks in all three — "tiktok", "chicago" and "social" are each a
  // reasonable way to reach the same posting.
  assert.match(view, /\$\{p\.company\} \$\{p\.title\} \$\{p\.location \|\| ""\}/);

  // every, not some: "product chicago" must narrow rather than widen.
  assert.match(view, /terms\.every\(t => hay\.includes\(t\)\)/);

});


test("many roles at one employer collapse into one row", () => {

  // TikTok posted five product internships in a day and caps applicants at TWO
  // company-wide. A flat list of five reads as five opportunities when it is a
  // choice between them.
  const view = read("web/app/JobsView.js");

  assert.match(view, /const byCompany = new Map\(\)/);

  // A single role is not a group — collapsing it would hide a posting behind a
  // tap for nothing.
  assert.match(view, /if \(g\.postings\.length === 1\)/);

  // The group takes the rank of its best posting rather than recomputing, so
  // "closing soonest" still puts the urgent employer first.
  assert.match(view, /Math\.max\(\.\.\.g\.postings\.map\(p => p\.match_score \|\| 0\)\)/);

  // And it has to show what he has already spent on that employer.
  assert.match(view, /applied > 0 &&/);

});


test("a hand-added posting lands in the same table as every other", () => {

  // The feed, the stage buttons, the Sankey and the weekly digest all read
  // job_postings. A separate table for hand-added roles would be six surfaces
  // that each have to remember to look in two places.
  const jobs = read("web/tools/jobs.js");

  const add = jobs.slice(jobs.indexOf("export async function addManualPosting"), jobs.indexOf("export async function setJobStatus"));

  assert.ok(add.length > 400, "addManualPosting is gone");

  assert.match(add, /from\("job_postings"\)/);

  // Stable key, so adding the same role twice updates instead of duplicating.
  assert.match(add, /external_id: `manual:/);
  assert.match(add, /ignoreDuplicates: false/);

  // Never buzzes him about a posting he is looking at right now.
  assert.match(add, /notified_at: now/);

  // Applying has to open a pipeline entry, or the flow chart silently omits
  // every application he added by hand.
  assert.match(add, /recordJobEvent\(\{ posting_id: data\.id, stage: "applied" \}\)/);

});


test("the poller never tries to crawl a hand-added row", () => {

  const jobs = read("web/tools/jobs.js");

  const add = jobs.slice(jobs.indexOf("export async function addManualPosting"), jobs.indexOf("export async function setJobStatus"));

  // Its own source row, inactive — pollJobBoards selects on active.
  assert.match(add, /ats: "manual"[\s\S]{0,80}active: false/);

});


test("a truncated poll rotates rather than starving the same boards forever", () => {

  // The watchlist went from 182 to 509. A pass that hits its time budget stops
  // starting new boards — and with no ordering the same rows came back in the
  // same order every time, so the first ~200 were polled every fifteen minutes
  // and the last ~300 were never polled at all. Silently, because an unpolled
  // board looks exactly like one with no new postings.
  const jobs = read("web/tools/jobs.js");

  const poll = jobs.slice(jobs.indexOf("export async function pollJobBoards"));

  assert.match(
    poll.slice(0, 1600),
    /\.order\("last_checked_at", \{ ascending: true, nullsFirst: true \}\)/,
    "least recently checked first, or a truncated pass starves the tail"
  );

  // A board added today has never been checked, so it must sort to the front
  // rather than the back.
  assert.match(poll.slice(0, 1600), /nullsFirst: true/);

});


test("a Lever posting is read whole, not just its opening paragraph", () => {

  // Lever splits a posting across four fields and only one is the pitch.
  // descriptionPlain is the opening paragraph — what the job sounds like — and
  // every REQUIREMENT lives in `lists` and `additionalPlain`. Measured on
  // Palantir's "Product Designer, Internship": descriptionPlain is 942
  // characters and the whole posting is 4,604, with "Must be planning on
  // graduating in 2028" inside a list.
  //
  // Three separate complaints — foreign roles, roles for 2028 graduates, and
  // missing pay and requirements — were all this one omission, across 36 Lever
  // boards.
  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /function leverText\(job\)/);

  const lever = jobs.slice(jobs.indexOf("function leverText(job)"), jobs.indexOf("function leverText(job)") + 900);

  for (const field of ["descriptionPlain", "additionalPlain", "lists"]) {
    assert.ok(lever.includes(field), `leverText must read ${field}`);
  }

  // And the adapter must actually use it.
  assert.match(jobs, /return stripHtml\(leverText\(body\)\)/);

});


test("where a posting says it is beats where the board filed it", () => {

  // scorePosting runs at poll time on the location string, which is frequently
  // a head office or a bare "Remote" while the description names Tokyo. The
  // same rule is re-run at enrichment, against the words.
  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /export const FOREIGN/, "the rule has to be shared, not duplicated");

  const enrich = jobs.slice(jobs.indexOf("export async function enrichJobDetails"));

  assert.match(enrich.slice(0, 4000), /const foreign = readable/);

  // Only the head of the description: run over the whole body it would match
  // "our London office" in a paragraph about the company and discard a Chicago
  // role.
  assert.match(enrich.slice(0, 4000), /usable\.slice\(0, 600\)/);

  // Demoted the same way scorePosting demotes, so there is one exclusion
  // mechanism rather than two that must be kept in step. Sliced generously —
  // the write sits ~4,500 characters into the function, and a slice(0, 4000)
  // would silently miss it while looking like a real assertion.
  assert.match(enrich.slice(0, 8000), /match_score: -99/);

});


test("the card says when it could not read the requirements", () => {

  // Some pages render their text in JavaScript and yield nothing to a plain
  // fetch, so the app genuinely does not know. An empty space reads as "fine".
  const view = read("web/app/JobsView.js");

  assert.match(view, /Couldn&rsquo;t read the requirements/);
  assert.match(view, /posting\.grad_fit === "ok"/);

  // And the feed has to carry the flag without shipping the whole description.
  const jobs = read("web/tools/jobs.js");
  assert.match(jobs, /detailRead: String\(description \|\| ""\)/);
  assert.doesNotMatch(jobs, /postings: deduped,/);

});
