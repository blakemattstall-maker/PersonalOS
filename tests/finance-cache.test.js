import test from "node:test";
import assert from "node:assert/strict";

import { sliceToWindow } from "../lib/simplefin.js";


// getFinancialData() now caches SimpleFIN's response for up to 12 hours and
// serves every requested window (7 days, 30, 90...) as a slice of one wide
// cached fetch, instead of a separate live call per window. This is the pure
// part of that: narrowing a cached payload down to N days and rehydrating
// dates. It's the part most likely to have a silent off-by-one, and the only
// part testable without a live finance_cache table (DDL can't run through
// PostgREST, so the read/write cache paths themselves are verified against
// the real database once the migration has been applied by hand — see
// docs/schema-finance-cache.sql).

function daysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}


test("slices out transactions older than the requested window", () => {

  const payload = {
    accounts: [{
      id: "a1",
      balance: 500,
      transactions: [
        { id: "t1", amount: -10, date: daysAgo(2) },
        { id: "t2", amount: -20, date: daysAgo(15) },
        { id: "t3", amount: -30, date: daysAgo(45) }
      ]
    }]
  };

  const week = sliceToWindow(payload, 7);
  assert.deepEqual(week.accounts[0].transactions.map(t => t.id), ["t1"]);

  const month = sliceToWindow(payload, 30);
  assert.deepEqual(month.accounts[0].transactions.map(t => t.id), ["t1", "t2"]);

  const quarter = sliceToWindow(payload, 90);
  assert.deepEqual(quarter.accounts[0].transactions.map(t => t.id), ["t1", "t2", "t3"]);

});


test("rehydrates ISO date strings back into real Date objects", () => {

  // JSONB has no native date type, so cached transactions round-trip through
  // JSON.stringify as strings. Every existing caller (tools/finances.js's
  // DateTime.fromJSDate, tools/metrics.js) expects a real Date, exactly as
  // the uncached version always returned — a string here would break both
  // silently (DateTime.fromJSDate on a string produces an Invalid DateTime,
  // not a thrown error).
  const payload = {
    accounts: [{ id: "a1", transactions: [{ id: "t1", amount: -5, date: daysAgo(1) }] }]
  };

  const sliced = sliceToWindow(payload, 30);
  const date = sliced.accounts[0].transactions[0].date;

  assert.ok(date instanceof Date, "expected a Date instance, not a string");
  assert.ok(!Number.isNaN(date.getTime()), "expected a valid Date");

});


test("balances and account metadata pass through untouched — they are not day-windowed", () => {

  const payload = {
    accounts: [{ id: "a1", org: "Test Bank", balance: 1234.56, transactions: [] }]
  };

  const sliced = sliceToWindow(payload, 7);

  assert.equal(sliced.accounts[0].balance, 1234.56);
  assert.equal(sliced.accounts[0].org, "Test Bank");

});


test("multiple accounts are each sliced independently", () => {

  const payload = {
    accounts: [
      { id: "a1", transactions: [{ id: "t1", amount: -1, date: daysAgo(1) }, { id: "t2", amount: -1, date: daysAgo(60) }] },
      { id: "a2", transactions: [{ id: "t3", amount: -1, date: daysAgo(2) }] }
    ]
  };

  const sliced = sliceToWindow(payload, 30);

  assert.deepEqual(sliced.accounts[0].transactions.map(t => t.id), ["t1"]);
  assert.deepEqual(sliced.accounts[1].transactions.map(t => t.id), ["t3"]);

});
