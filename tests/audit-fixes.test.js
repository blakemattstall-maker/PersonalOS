import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { groupByShape } from "../web/lib/supabase.js";


// Four defects found by an audit run after the savePerson ReferenceError, all
// of the same family: something is destroyed or overwritten, and the report
// afterwards does not say so.


const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const jobs = read("web/tools/jobs.js");
const mealPlan = read("web/tools/mealPlan.js");


// Slices bounded at the next declaration. An unbounded slice is how the
// reminder test below came to be satisfied by a copy of the same filter in a
// different function 140 lines away.
function functionBody(source, name) {
  const start = source.indexOf(name);
  assert.ok(start !== -1, `${name} is gone — this test is not reading what it thinks`);
  const after = source.slice(start + name.length);
  const next = after.search(/\nexport (async )?function /);
  return next === -1 ? after : after.slice(0, next);
}


// ---------------------------------------------------------------------------
// A bulk upsert where only some rows carry a column
// ---------------------------------------------------------------------------

test("rows are grouped by exactly which columns they carry", () => {

  const groups = groupByShape([
    { id: 1, title: "a", deadline: "2026-11-01" },
    { id: 2, title: "b" },
    { id: 3, title: "c" },
    { id: 4, title: "d", deadline: "2026-12-05" }
  ]);

  assert.equal(groups.length, 2);

  const withDeadline = groups.find(g => "deadline" in g[0]);
  const without = groups.find(g => !("deadline" in g[0]));

  assert.deepEqual(withDeadline.map(r => r.id), [1, 4]);
  assert.deepEqual(without.map(r => r.id), [2, 3]);

});


test("the order the keys were written in does not split a group", () => {

  const groups = groupByShape([
    { a: 1, b: 2 },
    { b: 3, a: 4 }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);

});


test("nothing in, nothing out", () => {

  assert.deepEqual(groupByShape([]), []);
  assert.deepEqual(groupByShape(null), []);
  assert.deepEqual(groupByShape(undefined), []);

});


test("every row survives the grouping", () => {

  // A group that silently drops rows would be a far worse bug than the one
  // this replaces.
  const rows = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    ...(i % 3 === 0 ? { deadline: "x" } : {}),
    ...(i % 5 === 0 ? { term: "y" } : {})
  }));

  const groups = groupByShape(rows);

  assert.equal(groups.flat().length, rows.length);
  assert.deepEqual(new Set(groups.flat().map(r => r.id)), new Set(rows.map(r => r.id)));

});


test("the jobs poll writes through it, because two of its columns are conditional", () => {

  // supabase-js builds `columns=` from the UNION of keys across the batch, so a
  // key present on one row and absent on another is written as NULL for the
  // others — and on conflict that NULL lands on top of a stored value. The
  // poll's `deadline` is exactly that shape, and the value it was overwriting
  // was the one enrichJobDetails had read out of the job description.
  const poll = functionBody(jobs, "export async function pollJobBoards");

  assert.match(poll, /upsertUniform\(/, "the poll must not use a bare bulk upsert");

  assert.ok(
    !/supabase\s*\n?\s*\.from\("job_postings"\)\s*\n?\s*\.upsert\(/.test(poll),
    "a raw multi-row upsert is back in the poll"
  );

});


// ---------------------------------------------------------------------------
// A poll overwriting what enrichment learned
// ---------------------------------------------------------------------------

test("a poll does not recompute term for a posting that has been enriched", () => {

  // enrichJobDetails derives term from the fetched DESCRIPTION — the only way
  // "Summer 2027 cohort" in the body of a posting titled "Product Management
  // Intern" is ever found — then stamps detail_fetched_at and never revisits
  // the row. So a poll that recomputes term from the title alone destroys the
  // better answer permanently, 96 times a day, and the whole feed filters on
  // term.
  const poll = functionBody(jobs, "export async function pollJobBoards");

  assert.match(
    poll,
    /enriched\.has\(p\.external_id\) \? \{\} : \{ term: classifyTerm/,
    "term must be omitted for rows enrichment has already read"
  );

  assert.match(
    poll,
    /select\("external_id, detail_fetched_at"\)/,
    "and the poll has to know which rows those are"
  );

});


test("enrichment is still the thing that gets to refine term", () => {

  const enrich = functionBody(jobs, "export async function enrichJobDetails");

  assert.match(enrich, /classifyTerm\(\{ title: [\s\S]{0,80}description/,
    "enrichment must classify from the description, not the title alone");

  assert.match(enrich, /detail_fetched_at/, "and stamp the row so it is not re-read");

});


// ---------------------------------------------------------------------------
// A plan deleted before its replacement existed
// ---------------------------------------------------------------------------

test("the old meal plan is removed only after the new one has landed", () => {

  const plan = functionBody(mealPlan, "export async function planMeals");

  const write = plan.indexOf("const logged = await logMealItems(");
  const guard = plan.indexOf("if (!logged.success) return logged;");
  const remove = plan.indexOf("await replaceStale(meal);");

  assert.ok(write > 0 && guard > write, "the write and its guard must both be found");

  assert.ok(
    remove > guard,
    "the stale plan must be deleted after the replacement is written and checked, " +
    "or a planner that returns nothing usable eats the plan it was asked to redo"
  );

});


test("nothing deletes a plan before the picks have been validated", () => {

  const plan = functionBody(mealPlan, "export async function planMeals");

  const validate = plan.indexOf("Validation is where hallucinated items die");

  assert.ok(validate > 0, "the validation step is gone");

  // The CALL sites, not the helper's definition — replaceStale is declared
  // above the loop and that is fine; what matters is when it runs.
  const calls = [...plan.matchAll(/await replaceStale\(/g)].map(m => m.index);

  assert.equal(calls.length, 1, "there should be exactly one place a stale plan is removed");

  assert.ok(
    calls[0] > validate,
    "the delete must run after validation — the Plan button targets EVERY remaining " +
    "meal, so a planner that answers for dinner only used to delete lunch too"
  );

  // And removeLogEntry must stay behind that one door.
  const direct = [...plan.matchAll(/removeLogEntry\(/g)].map(m => m.index);

  assert.equal(direct.length, 1, "removeLogEntry is being called from somewhere other than replaceStale");

});


test("a meal is never deleted twice by one run", () => {

  // Two picks naming the same meal would otherwise re-issue the delete against
  // ids already gone.
  const plan = functionBody(mealPlan, "export async function planMeals");

  assert.match(plan, /const removed = new Set\(\)/);
  assert.match(plan, /!removed\.has\(r\.id\)/);

});
