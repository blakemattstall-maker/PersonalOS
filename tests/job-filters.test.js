import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  classifyTerm, classifyGradFit, classifyField, parsePay,
  isOtherCampusProgram, HIDDEN_FIELDS, GRAD_YEAR, parseDeadline
} from "../web/lib/jobFilters.js";

import { scorePosting } from "../web/tools/jobs.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


// One function's body, and nothing after it.
//
// `source.slice(source.indexOf("export async function reviewJobDeadlines"))`
// looks like it reads that function. It reads it and every function below it to
// the end of the file — and briefJobFacts, 140 lines further down, applies the
// same three-line eligibility filter. So the test named "reminders apply the
// same filters as the feed" passed against briefJobFacts's copy: deleting the
// filter from reviewJobDeadlines entirely left the whole suite green while the
// closing-soon push went back to announcing Fall 2026 roles as "closes today".
//
// Bounded at the next top-level declaration, and loud when it cannot find the
// function at all.
function functionBody(source, name) {

  const start = source.indexOf(name);

  assert.ok(start !== -1, `${name} is gone — this test is not reading what it thinks`);

  const after = source.slice(start + name.length);

  const next = after.search(/\nexport (async )?function /);

  return next === -1 ? after : after.slice(0, next);

}


// ---------------------------------------------------------------------------
// Reading a posting the way the owner would. He wants summer 2027 only, he is
// class of 2029, and he named the disciplines that waste his time. The rule
// underneath all of it: SILENCE IS NOT A NO — only an explicit statement may
// rule a posting out, because most early-cycle postings state nothing.
// ---------------------------------------------------------------------------


test("a posting that names a term is taken at its word", () => {

  assert.equal(classifyTerm({ title: "Product Management Intern (Summer 2027)" }), "summer_2027");
  assert.equal(classifyTerm({ title: "Summer 2027 Intern - Brand" }), "summer_2027");
  assert.equal(classifyTerm({ title: "Marketing Intern, Summer '27" }), "summer_2027");

  // Real titles from the live feed, all of which were cluttering it.
  assert.equal(classifyTerm({ title: "Social Media Internships: NYC - Fall 2026" }), "other");
  assert.equal(classifyTerm({ title: "Intern, Digital Video (Winter 2026)" }), "other");
  assert.equal(classifyTerm({ title: "2026 Summer Analyst" }), "other");

});


test("a posting that names no term stays in — it has not decided yet", () => {

  // Most of a season's postings look like this in August. Treating silence as
  // a rejection would hide the majority of what he is hunting for.
  assert.equal(classifyTerm({ title: "Marketing Intern" }), "unspecified");
  assert.equal(classifyTerm({ title: "Intern, Brand Partnerships" }), "unspecified");

  // The description can still settle it.
  assert.equal(
    classifyTerm({ title: "Marketing Intern", description: "Our Summer 2027 program runs twelve weeks." }),
    "summer_2027"
  );

});


test("eligibility is only ever decided by what the posting actually says", () => {

  assert.equal(GRAD_YEAR, 2029, "he is class of 2029 — a sophomore this year");

  // Stated requirements he does not meet.
  assert.equal(classifyGradFit("Must be graduating between December 2027 and June 2028."), "blocked");
  assert.equal(classifyGradFit("Open to the class of 2027 and 2028."), "blocked");
  assert.equal(classifyGradFit("This role is intended for a rising senior."), "blocked");
  assert.equal(classifyGradFit("We seek graduating seniors."), "blocked");
  assert.equal(classifyGradFit("MBA candidates only."), "blocked");

  // Stated requirements he does meet.
  assert.equal(classifyGradFit("Open to students in the class of 2029."), "ok");
  assert.equal(classifyGradFit("Open to sophomores and juniors."), "ok");
  assert.equal(classifyGradFit("Rising juniors encouraged to apply."), "ok");

  // A range includes what is between its ends.
  assert.equal(classifyGradFit("Graduating between May 2028 and December 2029."), "ok");

  // Silence is not a no.
  assert.equal(classifyGradFit("You will support the brand team."), "unknown");
  assert.equal(classifyGradFit(""), "unknown");

});


test("the disciplines he asked to cut are recognised as such", () => {

  // Every one of these was in the live feed when he complained.
  assert.equal(classifyField("Trial Attorney Intern"), "legal");
  assert.equal(classifyField("Supply Chain Data Analyst Internship 2027"), "supply_chain");
  assert.equal(classifyField("Summer 2027 Intern - P&C Actuarial"), "finance");
  assert.equal(classifyField("Software Engineer Intern"), "technical");

  for (const field of ["legal", "supply_chain", "finance", "technical"]) {
    assert.ok(HIDDEN_FIELDS.has(field), `${field} should be hidden by default`);
  }

  // And the ones he wants are not casualties of that.
  assert.equal(classifyField("Brand Marketing Intern"), "marketing");
  assert.equal(classifyField("Product Management Intern"), "product");
  assert.equal(classifyField("Talent Relations Internship"), "media");
  assert.equal(classifyField("Business Development Intern"), "business");

  for (const field of ["marketing", "product", "media", "business"]) {
    assert.ok(!HIDDEN_FIELDS.has(field), `${field} must stay visible`);
  }

});


test("an internship at a campus he does not attend is a dead end", () => {

  assert.equal(isOtherCampusProgram("UIUC Research Park Intern - Validation"), true);
  assert.equal(isOtherCampusProgram("Purdue Campus Ambassador Intern"), true);

  // His own school, and ordinary roles, are untouched.
  assert.equal(isOtherCampusProgram("Illinois State Redbird Intern"), false);
  assert.equal(isOtherCampusProgram("Marketing Intern"), false);

});


test("pay is read when stated and left null when not", () => {

  assert.deepEqual(parsePay("The pay range is $25.00 - $32.00 per hour."),
    { pay_min: 25, pay_max: 32, pay_period: "hour" });

  assert.deepEqual(parsePay("Salary: $70,000 to $90,000 annually"),
    { pay_min: 70000, pay_max: 90000, pay_period: "year" });

  // Unstated must stay null — never zero, or "didn't say" would sort as
  // "unpaid" and bury a good role.
  assert.deepEqual(parsePay("No compensation stated here."),
    { pay_min: null, pay_max: null, pay_period: null });

  assert.equal(parsePay("").pay_min, null);

});


test("the feed and the alerts both respect the term", () => {

  const jobs = read("web/tools/jobs.js");

  // A posting that names a term he ruled out must never buzz.
  assert.match(jobs, /row\.term !== "other"/);

  // And the feed keeps summer 2027 plus the undecided, minus anyone whose own
  // rules exclude him.
  assert.match(jobs, /p\.term === "summer_2027" \|\| p\.term === "unspecified"/);
  assert.match(jobs, /p\.grad_fit !== "blocked"/);

  // Reading descriptions must degrade rather than fail when the migration
  // has not been pasted yet.
  assert.match(jobs, /Run docs\/schema-jobs-detail\.sql/);

});


test("descriptions are read once per posting, not once per poll", () => {

  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /\.is\("detail_fetched_at", null\)/, "already-read postings must be skipped");
  assert.match(jobs, /detail_fetched_at: new Date\(\)\.toISOString\(\)/);

});


test("the jobs feed can be sorted four ways", () => {

  const view = read("web/app/JobsView.js");

  for (const key of ["recent", "nearby", "pay", "match"]) {
    assert.match(view, new RegExp(`key: "${key}"`), `missing the ${key} sort`);
  }

  // Newest is the tiebreaker everywhere: of two equally good roles, the fresh
  // one is the one still worth applying to.
  assert.match(view, /new Date\(b\.first_seen_at\) - new Date\(a\.first_seen_at\)/);

});


test("a deadline is only read when the posting plainly states one", () => {

  const now = new Date("2026-08-21T00:00:00Z");

  assert.equal(parseDeadline("Applications close on September 15, 2026.", now), "2026-09-15");
  assert.equal(parseDeadline("The deadline to apply is 10/31/2026.", now), "2026-10-31");

  // A bare month/day means the NEXT one — "apply by March 1" written in August
  // is next March, not the one already gone.
  assert.equal(parseDeadline("Apply by March 1 to be considered.", now), "2027-03-01");

  // A start date is not a deadline, and a posted date is not a deadline. A
  // wrong deadline hides a live posting, which is worse than none.
  assert.equal(parseDeadline("Our program starts June 2027 and runs 12 weeks.", now), null);
  assert.equal(parseDeadline("Posted August 2026. You will support the brand team.", now), null);
  assert.equal(parseDeadline("", now), null);

});


test("reminders claim their cooldown before sending, and only for real matches", () => {

  const jobs = read("web/tools/jobs.js");
  const review = functionBody(jobs, "export async function reviewJobDeadlines");

  // Same claim-then-send order as every other alert here.
  const claim = review.indexOf("last_nudged_at: now.toISOString()");
  const push = review.indexOf("sendPush(");
  assert.ok(claim > 0 && claim < push, "the cooldown must be claimed before the push");

  // A closing-soon alert is only worth sending for something he could
  // actually get.
  assert.match(review, /gte\("match_score", 3\)/);
  assert.match(review, /in\("status", \["new", "saved"\]\)/);

  // Applying records when, or silence can never be noticed.
  assert.match(jobs, /if \(status === "applied"\) patch\.applied_at/);

});


test("a US location is recognised by allowlist, not by ruling out the world", () => {

  // Amazon posts operations internships across Spain, Italy, France and Brazil
  // — Valencia, Tarragona, Asturias, Figueres, Abruzzo, Lazio, Région Nord,
  // Nova Santa Rita. Naming every foreign region is endless; naming the fifty
  // states is finite and permanent.
  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /const US_STATE = /);
  assert.match(jobs, /const VAGUE_LOCATION = /);

  // The state code must be anchored to the END of the string. Amazon's
  // "IT, RI, Passo Corese" is Rieti in Italy, and an unanchored match read it
  // as Rhode Island and scored an Italian warehouse as a US role.
  assert.match(jobs, /US_ABBREV = \/,\\s\*\([A-Z|]+\)\(\\s\+\\d\{5\}\)\?\\s\*\$\//);

});


test("no single company may own the feed", () => {

  // Amazon alone has ~200 intern postings; unbounded, they were 60 of the 60
  // rows on the page and every other company on the watchlist was invisible.
  const jobs = read("web/tools/jobs.js");

  assert.match(jobs, /perCompany/);
  assert.match(jobs, /count <= 6/);

});


test("trade and technician roles are not internships he can use", () => {

  const jobs = read("web/tools/jobs.js");

  for (const term of ["technician", "assembler", "machinist", "fabricator", "welder"]) {
    assert.match(jobs, new RegExp(term), `${term} should be on the no-chance list`);
  }

  // And a title with seniority is a job, not an internship, unless it also
  // says intern: "Head of Early Career Recruiting" is a $225k full-time role
  // that matched on the words "early career".
  assert.match(jobs, /SENIOR_TITLE/);
  assert.match(jobs, /SAYS_INTERN/);

});


test("the places no feed can reach are listed where he will see them", async () => {

  const { MANUAL_TARGETS, isStale } = await import("../web/lib/manualTargets.js");

  // The giants that answer a plain request with an empty body, and Handshake,
  // which needs his login — none of these can ever be polled.
  for (const slug of ["microsoft", "google", "apple", "meta", "handshake"]) {
    assert.ok(MANUAL_TARGETS.some(t => t.slug === slug), `${slug} must be on the manual list`);
  }

  // And the Chicago independents, which are the opposite problem: too small to
  // have software, which is exactly why an email works.
  const small = MANUAL_TARGETS.filter(t => t.kind === "small");
  assert.ok(small.length >= 8, `only ${small.length} small studios listed`);

  // Every entry needs somewhere to go and a reason to bother.
  for (const t of MANUAL_TARGETS) {
    assert.match(t.url, /^https:\/\//, `${t.slug} has no usable link`);
    assert.ok((t.note || "").length > 20, `${t.slug} needs a note saying why`);
    assert.ok(t.group, `${t.slug} needs a group`);
  }

  // Never looked at is stale by definition, and two weeks is the limit.
  assert.equal(isStale(null), true);
  assert.equal(isStale(new Date().toISOString()), false);
  assert.equal(isStale(new Date(Date.now() - 20 * 86400000).toISOString()), true);

  // The check-off state rides in settings rather than a new table.
  assert.match(read("web/lib/settings.js"), /manual_checks/);
  assert.match(read("web/app/career/jobs/page.js"), /ManualTargets/);

});


test("roles he is nowhere near qualified for are cut, not merely ranked low", () => {

  // Every one of these was live in his feed when he complained: quant trading
  // at a Chicago prop shop, sysadmin, tool-and-die apprenticeships, a graduate
  // programme, and a campus programme at a school he does not attend.
  for (const title of [
    "Quantitative Trading Intern - Summer 2027",
    "Systems Administration Internship",
    "Application Development Internship",
    "Analytics Internship",
    "Tool & Die Maker Apprentice",
    "Youth Apprentice - PCBA (Assembly)",
    "Capital Markets Summer 2027 Internship",
    "Human Resources Master's Internship",
    "On Campus Internship - Louisiana State University"
  ]) {
    // The feed's real gate is both halves: is_internship AND match_score >= 1.
    // A graduate programme fails the first, a quant role fails the second, and
    // asserting only one of them tests the wrong thing.
    const { score, isInternship } = scorePosting({ title, location: "Chicago, IL" });
    assert.ok(
      !isInternship || score < 1,
      `"${title}" would still reach the feed (internship=${isInternship}, score=${score})`
    );
  }

});


test("widening the wanted fields is what makes the cut safe", () => {

  // "other" is hidden again — which is only defensible because these now
  // classify correctly instead of falling into it. Getting this backwards is
  // what cut the feed to four postings once already.
  for (const [title, field] of [
    ["Product Development Intern", "product"],
    ["Product Innovation Intern - Credit & Fraud", "product"],
    ["Product Strategy Intern", "product"],
    ["Community Product Management Intern", "product"],
    ["Intern, Social Marketing", "marketing"],
    ["Communications Internship", "marketing"],
    ["Sales Internship - Summer 2027", "business"]
  ]) {
    assert.equal(classifyField(title), field, `"${title}" misclassified`);
  }

  assert.ok(HIDDEN_FIELDS.has("other"), "unrecognised titles must not reach the feed");

});


test("a role abroad is cut outright, not penalised into visibility", () => {

  // Barcelona scored 7 on "marketing" plus "content" and survived a -5
  // penalty at 2, which was enough to stay on the page.
  for (const loc of ["Barcelona", "Sysco LABS - Sri Lanka", "Budapest Szabadsag Ter"]) {
    const { score } = scorePosting({ title: "B2B Marketing Content Intern", location: loc });
    assert.ok(score < 1, `${loc} scored ${score}`);
  }

  // A two-letter code is not proof of a US state: Lucid's "Amsterdam, NH" is
  // Noord-Holland, and the foreign check has to beat the allowlist.
  assert.ok(scorePosting({ title: "Business Operations Intern", location: "Amsterdam, NH" }).score < 1);

  // And a real US location still passes.
  assert.ok(scorePosting({ title: "Marketing Intern", location: "Chicago, IL" }).score >= 3);

});


test("the nearby sort ranks by distance instead of a yes/no", () => {

  const view = read("web/app/JobsView.js");

  // A single boolean counted Milwaukee as "nearby" alongside Chicago, so
  // Wisconsin sat above Illinois at the top of the list.
  assert.match(view, /function proximity/);
  assert.match(view, /CHICAGO\.test\(loc\)\) return 4/);
  assert.match(view, /ILLINOIS\.test\(loc\)\) return 3/);
  assert.match(view, /MIDWEST\.test\(loc\)\) return 2/);
  assert.doesNotMatch(view, /const isNearby/, "the old boolean must be gone");

});


test("a deadline written day-first, or falling today, is read correctly", () => {

  const now = new Date("2026-08-21T12:00:00Z");

  // Abbott writes "Closing Date: 19 September 2026". Without a negative
  // lookahead the day pattern read "September 2026" as the 20th — a real
  // posting was stored with the wrong date.
  assert.equal(parseDeadline("Closing Date: 19 September 2026 Apply now", now), "2026-09-19");
  assert.equal(parseDeadline("Application Deadline: September 19, 2026", now), "2026-09-19");
  assert.equal(parseDeadline("Apply by 3 October 2026", now), "2026-10-03");

  // A deadline of today is today. Comparing against the current INSTANT
  // rather than the start of the day pushed a same-day deadline a year out.
  assert.equal(parseDeadline("Applications close on August 21", now), "2026-08-21");

  // And prose about meeting deadlines is still not a deadline.
  assert.equal(parseDeadline("ensuring deadlines and deliverables are met", now), null);

});


test("reminders apply the same filters as the feed", () => {

  const jobs = read("web/tools/jobs.js");
  const review = functionBody(jobs, "export async function reviewJobDeadlines");

  // It was about to announce a Fall 2026 role as "closes today" — a posting
  // the feed hides. A reminder about something already ruled out teaches him
  // to ignore reminders.
  assert.match(review, /r\.term === "summer_2027" \|\| r\.term === "unspecified"/);
  assert.match(review, /r\.grad_fit !== "blocked"/);
  assert.match(review, /NOTIFY_FIELDS\.has\(r\.field\)/);

});


test("junior-status only is not the same claim as rising junior", () => {

  // Both contain the word "junior" and they mean opposite things for a 2029
  // graduate. A RISING junior in summer 2027 is him — he becomes a junior that
  // autumn. Being of JUNIOR STATUS during the internship is not.
  //
  // Uline's first minimum requirement, verbatim: "This full-time, 12-week
  // internship is open to Junior-status college students only." That posting
  // was fetched in full, classified "unknown", and sat in the feed looking open
  // — because the pattern list knew "rising senior" and not this.
  assert.equal(
    classifyGradFit("This full-time, 12-week internship is open to Junior-status college students only."),
    "blocked"
  );

  assert.equal(classifyGradFit("Open to juniors and seniors only."), "blocked");
  assert.equal(classifyGradFit("Applicants must be a junior at the time of the internship."), "blocked");

  // And the welcoming half still welcomes.
  assert.equal(classifyGradFit("We welcome rising junior applicants for this program."), "ok");
  assert.equal(
    classifyGradFit("Pursuing a 4-year degree with preferred current standing of Sophomore/Junior level"),
    "ok"
  );

  // Silence is still not a no.
  assert.equal(classifyGradFit("Currently pursuing a Bachelor's degree in Marketing or Business."), "unknown");

});
