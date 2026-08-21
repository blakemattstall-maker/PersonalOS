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

  const workflow = read(".github/workflows/job-poll.yml");

  // Vercel's free crons fire once a day, which is useless for "apply the day
  // it posts". GitHub Actions is free and unlimited on a public repo.
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /api\/cron\/checkJobs/);
  assert.match(workflow, /secrets\.CRON_SECRET/);

  // A failed poll must fail the workflow, or a dead endpoint reads as a quiet
  // hiring market for weeks.
  assert.match(workflow, /test "\$code" = "200"/);

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
