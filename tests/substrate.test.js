import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MIGRATIONS_FOR_TEST } from "../web/lib/schema.js";
import { summarise, categorizeByRule, MODEL_CATEGORIES, CATEGORIES } from "../web/lib/categorize.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const signalsSource = read("web/lib/signals.js");
const metricsSource = read("web/tools/metrics.js");
const moneySource = read("web/lib/money.js");


// ---------------------------------------------------------------------------
// The drift detector has to cover everything it claims to.
// ---------------------------------------------------------------------------

test("every schema migration file is actually probed by lib/schema.js", () => {

  // lib/schema.js exists specifically so nobody has to trust a document about
  // which SQL has been run. It listed 8 of the 10 files — the two it missed
  // were the entity graph and nudge scheduling — so it could truthfully print
  // "All migrations applied and active" having never looked at the layer the
  // whole cross-domain feature set depends on. A guard with a hole in it is
  // worse than no guard, because it is believed.
  const files = readdirSync(join(root, "docs"))
    .filter(f => f.startsWith("schema-") && f.endsWith(".sql"))
    .map(f => `docs/${f}`)
    .sort();

  const probed = MIGRATIONS_FOR_TEST.map(m => m.file).sort();

  assert.deepEqual(
    files.filter(f => !probed.includes(f)),
    [],
    "a docs/schema-*.sql file with no entry in lib/schema.js's MIGRATIONS — it will " +
    "report as applied without ever being checked"
  );

  assert.deepEqual(
    probed.filter(f => !files.includes(f)),
    [],
    "MIGRATIONS names a file that no longer exists"
  );

});


test("every probed migration names at least one object and explains its absence", () => {

  for (const migration of MIGRATIONS_FOR_TEST) {

    const objects =
      (migration.tables || []).length +
      (migration.columns || []).length +
      (migration.functions || []).length;

    assert.ok(
      objects > 0,
      `${migration.file} probes nothing, so it can never report as missing`
    );

    assert.ok(
      migration.breaksWithout && migration.breaksWithout.length > 20,
      `${migration.file} does not say what breaks without it — that sentence is the ` +
      "entire value of the check when someone reads it cold"
    );

  }

});


// ---------------------------------------------------------------------------
// One definition of spending, everywhere.
// ---------------------------------------------------------------------------

test("a transfer can never be assigned by the model, only by rule", () => {

  // Whether something is a transfer decides whether it counts as spending. If a
  // model could answer "transfers" for an unfamiliar merchant, a real purchase
  // would silently vanish from the headline figure — and the paths that
  // classify with the model would stop agreeing with the paths that classify by
  // rule alone, which is the exact class of drift lib/money.js exists to end.
  assert.ok(
    !MODEL_CATEGORIES.includes("transfers"),
    "the model must not be able to move a row across the spending line"
  );

  assert.ok(
    !MODEL_CATEGORIES.includes("income"),
    "income is decided by the sign of the amount, before any classifier runs"
  );

  assert.ok(
    MODEL_CATEGORIES.every(c => CATEGORIES.includes(c)),
    "MODEL_CATEGORIES must stay a subset of CATEGORIES"
  );

  assert.equal(
    categorizeByRule({ payee: "Zelle Transfer To Aunt Rosa", description: "", amount: -400 }),
    "transfers"
  );

});


test("rules-only and rules-plus-model categorisation agree on every total", () => {

  // This is the property that lets lib/signals.js skip the model call without
  // reporting a different number than the money page. Unclassified merchants
  // land in "other" either way, and "other" is still spending.
  const rows = [
    { merchant: "Zelle To Rosa", category: "transfers", amount: -400 },
    { merchant: "Quality Food Centers", category: "groceries", amount: -95 },
    { merchant: "Some Unknown Shop", category: "other", amount: -60 },
    { merchant: "Payroll", category: "income", amount: 1200 }
  ];

  // The same rows as the model path would produce them: the unknown shop got a
  // real category instead of "other". Nothing else may move.
  const classified = rows.map(r =>
    r.merchant === "Some Unknown Shop" ? { ...r, category: "shopping" } : r
  );

  assert.equal(summarise(rows).spent, summarise(classified).spent, "spent must not depend on classification depth");
  assert.equal(summarise(rows).earned, summarise(classified).earned);
  assert.equal(summarise(rows).spent, 155, "transfers excluded, unknown merchant still counted");

});


test("no classifier answer can move the headline figure", () => {

  // The property MODEL_CATEGORIES exists to create, stated as a test.
  //
  // On live data the model was calling "Tagadapay.com" a transfer — it is a
  // payment processor, so the name reads like money movement — which silently
  // removed $188.44 of real purchases from the 90-day spend total. Worse, the
  // call is not perfectly reproducible, so the same window could report two
  // different totals on two cold containers with nothing to point at.
  //
  // Now the only categories a classifier can return are ones that leave every
  // total untouched: whatever it picks, the row is still spending.
  const base = { merchant: "Unfamiliar Shop", amount: -188.44 };

  const totals = MODEL_CATEGORIES.map(category => summarise([
    { ...base, category },
    { merchant: "Known", category: "groceries", amount: -10 }
  ]).spent);

  assert.deepEqual(
    [...new Set(totals)],
    [198.44],
    "every category the model is allowed to return must produce the same spend total"
  );

});


test("every path that totals spending goes through lib/money.js", () => {

  // Trap #17, twice more. lib/signals.js and tools/metrics.js each had their
  // own arithmetic over the same transactions and neither had heard of the
  // transfers category, so the signal every reasoning call carries said $2156
  // for the same 30 days the money page labelled $711.
  for (const [name, source] of [["lib/signals.js", signalsSource], ["tools/metrics.js", metricsSource]]) {

    assert.match(
      source,
      /from "\.\.?\/(lib\/)?money\.js"/,
      `${name} must take its money figures from lib/money.js, not compute its own`
    );

    assert.doesNotMatch(
      source,
      /getFinancialData/,
      `${name} must not reach past lib/money.js to the raw bank data — that is how ` +
      "a fourth summariser gets written"
    );

  }

  assert.match(
    metricsSource,
    /category !== "transfers"/,
    "daily_metrics is the longitudinal record; a wrong definition of spend here " +
    "poisons history that cannot be recompared later"
  );

});


test("lib/money.js defaults to the cheap classification path", () => {

  // buildRichContext() carries the finance signal into ten reasoning tools. If
  // the default flipped to classifying unknown merchants, every one of those
  // calls could pay for a model pass to improve a line that only reports totals.
  assert.match(
    moneySource,
    /classifyUnknown\s*=\s*false/,
    "loadMoney must default to rules-only; the money page opts in explicitly"
  );

});
