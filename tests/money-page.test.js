// The money page's own traps.
//
// Every test here corresponds to something that actually shipped broken. They
// are offline and pure: the finance handler is exercised through a stub of
// lib/simplefin.js rather than the live bank, so the whole file runs in
// milliseconds and can be run on every change.
//
// What they are collectively guarding is one theme. The dashboard used to reach
// the API over HTTP and now calls the same handler in-process, and that removed
// a JSON serialisation step nothing had noticed was load-bearing. A bug of this
// class cannot be caught by testing the handler's return value alone — it is
// only visible in the difference between what the handler returns and what a
// React tree can render.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { summarise, findRecurring, categorizeByRule, FINANCE_RANGES } from "../web/lib/categorize.js";


const backendSource = fs.readFileSync(new URL("../web/app/backend.js", import.meta.url), "utf8");
const handlerSource = fs.readFileSync(new URL("../web/app/api/[resource]/handler.js", import.meta.url), "utf8");
const financesSource = fs.readFileSync(new URL("../web/tools/finances.js", import.meta.url), "utf8");
const simplefinSource = fs.readFileSync(new URL("../web/lib/simplefin.js", import.meta.url), "utf8");


// ---------------------------------------------------------------------------
// A Date must never reach a React child.
// ---------------------------------------------------------------------------

// The crash: lib/simplefin.js hands back `date` as a real Date object, the
// finance handler's `recent` list passed it straight through, and MoneyView
// renders that value as text. Over HTTP it had been flattened to an ISO string
// on the way — ugly, but it rendered. In-process it arrives as a Date and React
// throws "Objects are not valid as a React child", which with no error.js
// anywhere in this app is the whole money page replaced by Next's built-in
// "This page couldn't load".
function nonJsonValues(value, path = "$") {

  if (value === null || typeof value !== "object") return [];

  // A Date survives structured-clone across the RSC boundary and only fails at
  // render, which is exactly why it got this far.
  if (value instanceof Date) return [`${path} (Date)`];

  if (Array.isArray(value)) {
    return value.flatMap((v, i) => nonJsonValues(v, `${path}[${i}]`));
  }

  return Object.entries(value).flatMap(([k, v]) => nonJsonValues(v, `${path}.${k}`));

}


test("no value the dashboard receives from a handler is a Date", async () => {

  const payload = await financePayload();

  assert.deepEqual(
    nonJsonValues(payload),
    [],
    "These would render as [object Date] or crash the page outright"
  );

});


test("the finance handler stringifies every date it emits, in every range", async () => {

  const payload = await financePayload();

  const dated = [
    ...payload.transactions.map(t => t.date),
    ...FINANCE_RANGES.flatMap(r => payload.views[r].recent.map(t => t.date))
  ];

  assert.ok(dated.length > 0, "fixture produced no dated rows, so this proves nothing");

  for (const date of dated) {
    assert.match(
      String(date),
      /^\d{4}-\d{2}-\d{2}$/,
      `every emitted date must be a bare yyyy-MM-dd string, got ${JSON.stringify(date)}`
    );
  }

});


test("backend.js serialises handler output, so no future handler can leak one", () => {

  // The per-field fix above is not enough on its own: the next handler to return
  // a Date, a Map or a class instance would reintroduce the same crash. The seam
  // itself has to restore what fetch().json() used to do.
  assert.match(
    backendSource,
    /JSON\.parse\(JSON\.stringify\(/,
    "app/backend.js must round-trip handler output through JSON, the way the HTTP hop it replaced did"
  );

});


// ---------------------------------------------------------------------------
// Every figure on the page agrees about what "spending" means.
// ---------------------------------------------------------------------------

const TRANSFER = { payee: "Zelle Transfer To Aunt Anita", description: "Zelle Transfer To Aunt Anita", amount: -400 };


test("a transfer is not spending, in the summary or the repeating list", () => {

  // summarise() has always skipped transfers. findRecurring() did not, so a
  // standing $400 Zelle to a relative was listed under "Repeating" as
  // "the spending most worth re-deciding", and the total the page prints for
  // that card could exceed the "Spent" figure directly above it.
  const rows = [
    { merchant: "Aunt Anita", category: "transfers", amount: -400, date: "2026-07-01" },
    { merchant: "Aunt Anita", category: "transfers", amount: -400, date: "2026-08-01" },
    { merchant: "Framer.com", category: "subscriptions", amount: -10, date: "2026-07-02" },
    { merchant: "Framer.com", category: "subscriptions", amount: -10, date: "2026-08-02" }
  ];

  assert.equal(summarise(rows).spent, 20);

  assert.deepEqual(
    findRecurring(rows).map(r => r.merchant),
    ["Framer.com"],
    "a recurring transfer is movement, not a subscription"
  );

});


test("the ask box and the charts above it total spending the same way", () => {

  // These two answered the same question about the same window with a 3x
  // difference on live data — $2,159.91 from the ask box against $714.98 on the
  // chart — because tools/finances.js had its own summariser that had never
  // heard of the transfers category. They share a route so they could not
  // drift; sharing a route turned out not to be sharing the arithmetic.
  assert.equal(
    categorizeByRule(TRANSFER),
    "transfers",
    "the rule that keeps transfers out of the charts"
  );

  assert.match(
    financesSource,
    /categorizeByRule/,
    "tools/finances.js must classify with the same rules the money page does, not its own"
  );

  assert.match(
    financesSource,
    /transfersOut/,
    "excluded from the totals, but still passed to the model — 'how much did I send my aunt' is a real question"
  );

});


// ---------------------------------------------------------------------------
// A warning has to mean something is wrong.
// ---------------------------------------------------------------------------

test("SimpleFIN advisories about our own request are not reported as bank problems", () => {

  // SimpleFIN comments on any window over 45 days, so `warnings` was never
  // empty. It went into the finance model's prompt under "Bank connection
  // warnings" and made a genuine re-auth notice indistinguishable from noise
  // that fires on every single call.
  assert.match(simplefinSource, /function realWarnings/);

  assert.doesNotMatch(
    simplefinSource,
    /warnings = data\.errors/,
    "data.errors must be filtered before it becomes a user-facing warning"
  );

  assert.doesNotMatch(
    simplefinSource,
    /warnings: row\.warnings \|\| \[\]/,
    "rows already cached with the old advisory must be filtered on read too"
  );

  // And the window must not ask for more history than SimpleFIN will serve,
  // which is what produced the permanent advisory in the first place.
  const window = Number(simplefinSource.match(/CACHE_WINDOW_DAYS = (\d+)/)?.[1]);

  assert.ok(
    window <= 89,
    `SimpleFIN caps at 90 days and warns at 90 exactly; CACHE_WINDOW_DAYS is ${window}`
  );

  assert.ok(
    window >= Math.max(...FINANCE_RANGES) - 1,
    `the cached window must still cover the widest range the money page offers (${Math.max(...FINANCE_RANGES)} days)`
  );

});


// ---------------------------------------------------------------------------
// Reaching the ingest function at all.
// ---------------------------------------------------------------------------

test("backend.js can route to the ingest handler, not just [resource]", () => {

  // backendPost("/api/ingest/push") asked the [resource] handler for a resource
  // called "ingest" and got {"error":"Unknown resource: ingest"} every time, so
  // no push subscription was ever saved. The HTTP route worked throughout, which
  // is why the consolidation did not notice.
  assert.doesNotMatch(
    handlerSource,
    /const RESOURCES = \{[^}]*\bingest\b/,
    "ingest is its own function with its own dynamic segment, not a [resource]"
  );

  assert.match(
    backendSource,
    /ingest.*\[kind\]\/handler\.js/,
    "app/backend.js must import the ingest handler"
  );

  assert.match(
    backendSource,
    /query\.kind = /,
    "the ingest handler reads req.query.kind, which no router supplies in-process"
  );

});


test("a push subscription that was not saved is not reported as saved", () => {

  // PushSetup.js awaited subscribeToPushAction and threw the result away, so the
  // settings page said "On. You'll get one message a day at most" while the
  // subscription had never been written and no notification could ever arrive.
  const actions = fs.readFileSync(new URL("../web/app/actions.js", import.meta.url), "utf8");

  const subscribe = actions.match(/export async function subscribeToPushAction[\s\S]*?\n\}/)?.[0] || "";

  assert.match(
    subscribe,
    /throw new Error/,
    "subscribeToPushAction must fail loudly; its caller reports success on anything that does not throw"
  );

  assert.doesNotMatch(
    actions,
    /process\.env\.BACKEND_URL/,
    "nothing in this app fetches its own API over HTTP any more — an unset BACKEND_URL made push setup fetch('undefined/api/...')"
  );

});


// ---------------------------------------------------------------------------
// The stub, and the handler run that every test above shares.
// ---------------------------------------------------------------------------

// Stubbed at the network boundary rather than at the module boundary, which
// matters more than it sounds like it should.
//
// An ES module namespace is frozen, so lib/simplefin.js cannot be swapped out
// after the fact, and mocking it would in any case skip the one step this file
// is about: sliceToWindow() rehydrating cached ISO strings into real Date
// objects. That rehydration is where the Date the money page choked on comes
// from, so it has to run. Intercepting fetch keeps every line of the real path —
// SimpleFIN normalisation, the cache decision, rehydration, categorisation, the
// handler — and still needs no network and no keys.
//
// The Supabase call is answered with PGRST205, the code lib/simplefin.js reads
// as "the finance_cache migration has not been applied", which is its documented
// pre-migration path: fetch live, serve, cache nothing.

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.SIMPLEFIN_ACCESS_URL = "https://user:pass@simplefin.test/simplefin";
delete process.env.API_SECRET;


const secondsAgo = (days) => Math.floor((Date.now() - days * 86400 * 1000) / 1000);

const BANK = {
  errors: [],
  accounts: [{
    id: "acct-1",
    org: { name: "Test Bank" },
    name: "CHECKING (1234)",
    currency: "USD",
    balance: "4908.86",
    transactions: [
      { id: "1", transacted_at: secondsAgo(1), amount: "-42.10", payee: "Trader Joe's", description: "TRADER JOE'S #123" },
      { id: "2", transacted_at: secondsAgo(3), amount: "-11.99", payee: "Spotify", description: "SPOTIFY USA" },
      { id: "3", transacted_at: secondsAgo(20), amount: "-11.99", payee: "Spotify", description: "SPOTIFY USA" },
      { id: "4", transacted_at: secondsAgo(21), amount: "1657.00", payee: "Payroll", description: "DIRECT DEPOSIT PAYROLL" },
      { id: "5", transacted_at: secondsAgo(40), amount: "-400.00", payee: "Zelle Transfer To Aunt Anita", description: "ZELLE TRANSFER" },
      { id: "6", transacted_at: secondsAgo(70), amount: "-31.40", payee: "Shell", description: "SHELL OIL 5544" }
    ]
  }]
};


function stubFetch() {

  const real = globalThis.fetch;

  globalThis.fetch = async (input) => {

    const url = String(input?.url || input);

    if (url.includes("simplefin.test")) {
      return new Response(JSON.stringify(BANK), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("supabase.test")) {
      return new Response(
        JSON.stringify({ code: "PGRST205", message: "Could not find the table in the schema cache" }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`unexpected network call in an offline test: ${url}`);

  };

  return () => { globalThis.fetch = real; };

}


let cached = null;

async function financePayload() {

  if (cached) return cached;

  const restore = stubFetch();

  try {

    const { default: handler } = await import("../web/app/api/[resource]/handler.js");

    let body = null;

    const res = {
      status() { return res; },
      setHeader() { return res; },
      json(payload) { body = payload; return res; },
      send(payload) { return res.json(payload); },
      end() { return res; }
    };

    await handler({ method: "GET", query: { resource: "finance" }, headers: {}, url: "/api/finance" }, res);

    assert.ok(body?.success, `finance handler did not succeed: ${JSON.stringify(body)}`);

    cached = body;

    return body;

  } finally {

    restore();

  }

}
