import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  classifyTerm, classifyGradFit, classifyField, parsePay,
  isOtherCampusProgram, HIDDEN_FIELDS, GRAD_YEAR
} from "../web/lib/jobFilters.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


// ---------------------------------------------------------------------------
// Reading a posting the way Blake would. He wants summer 2027 only, he is
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
