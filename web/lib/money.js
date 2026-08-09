import { getFinancialData } from "./simplefin.js";
import {
  categorizeTransactions,
  classifyUnknownMerchants,
  summarise
} from "./categorize.js";


// The only place a money figure comes from.
//
// This file exists because the same question — "how much did he spend in the
// last 30 days" — was being answered by four different pieces of arithmetic,
// and on live data two of them disagreed by 3x.
//
//   lib/categorize.js summarise()   $711  — the money page. Correct.
//   tools/finances.js summarize()   $711  — the ask box. Correct, after a fix.
//   lib/signals.js    financeSignal $2156 — every reasoning call in the system.
//   tools/metrics.js  spend_total   $2156 — the daily history rows.
//
// The last two totalled every negative row, so three Zelle transfers worth
// $1,445 were being reported as purchases. That is trap #17 in the README
// ("sharing an entry point is not sharing the arithmetic — share the
// function"), and it had recurred in the two places with the widest blast
// radius: `signals` rides inside buildRichContext() into ten reasoning tools,
// and `daily_metrics` is the longitudinal record, so every day the wrong
// definition ran it wrote another row of history that can never be compared
// against a correct one.
//
// So there is now one loader and one summariser, and every caller takes its
// figures from here.
//
// ── Why `classifyUnknown` defaults to off ────────────────────────────────
//
// Categorising an unfamiliar merchant costs a model call. The money page is
// happy to pay it: one page load, memoised for the life of the container, and
// the breakdown is the entire point of the page. `signals` is the opposite
// case — it rides in nearly every reasoning call the system makes, so paying
// for classification there would multiply the cost of the whole app to
// improve a line that only reports totals.
//
// It costs nothing in accuracy, and that is not a compromise — it is a
// property of how the split works. The only categories that change a total
// are `transfers` and `income`, and both are decided by rule before any model
// is consulted (see MODEL_CATEGORIES in lib/categorize.js). An unclassified
// merchant lands in "other" and is still counted as spending, exactly as it
// should be. Rules-only and rules-plus-model therefore produce the same
// `spent`, `earned` and `transferTotal` — they differ only in how finely the
// remainder is broken down.


// Load the window, categorised. Everything downstream slices this.
export async function loadMoney({ days = 30, classifyUnknown = false } = {}) {

  const raw = await getFinancialData({ days });

  const accounts = (raw.accounts || []).map(a => ({
    name: a.name,
    org: a.org,
    balance: Number(a.balance) || 0,
    currency: a.currency || "USD"
  }));

  // The account name is carried onto each row: SimpleFIN nests transactions
  // under their account, and flattening loses which one a charge came from.
  // tools/islands.js writes that into `transactions.account`, and without it
  // every stored charge belonged to no account.
  const { transactions, unmatchedMerchants } = await categorizeTransactions(
    (raw.accounts || []).flatMap(a =>
      (a.transactions || []).map(t => ({ ...t, account: a.name }))
    ),
    { classifyUnknown: classifyUnknown ? classifyUnknownMerchants : null }
  );

  return {
    accounts,
    balance: Math.round(accounts.reduce((total, a) => total + a.balance, 0) * 100) / 100,
    transactions,
    unmatchedMerchants,
    warnings: raw.warnings || [],
    fetchedAt: raw.fetchedAt,
    cached: raw.cached,
    stale: raw.stale === true
  };

}


// Transfers, kept rather than dropped.
//
// Excluding them from `spent` must not make them unanswerable — "how much did
// I send my aunt this month" is a real question about real money leaving the
// account. tools/finances.js already passes these to the model separately for
// exactly that reason; this returns them for any caller that wants the same.
export function transfersOf(transactions) {

  const out = transactions.filter(t => t.category === "transfers" && Number(t.amount) < 0);

  return {
    transfersOut: out,
    transferTotal: Math.round(out.reduce((total, t) => total + Math.abs(Number(t.amount)), 0) * 100) / 100
  };

}


// The headline figures, from the shared summariser.
//
// summarise() is lib/categorize.js's and is what the money page prints, so
// anything reading this is provably printing the same numbers the user sees on
// the page rather than its own interpretation of them.
export async function spendSummary({ days = 30, classifyUnknown = false } = {}) {

  const money = await loadMoney({ days, classifyUnknown });

  return {
    ...summarise(money.transactions),
    ...transfersOf(money.transactions),
    balance: money.balance,
    accounts: money.accounts,
    warnings: money.warnings,
    days,
    cached: money.cached,
    stale: money.stale
  };

}
