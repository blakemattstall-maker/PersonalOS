import supabase from "./supabase.js";


// SimpleFIN client, cached.
//
// Read-only by construction — the access URL grants balances and transactions
// and nothing that can move money. Chosen over Plaid, which is priced and
// shaped for companies rather than one person, at $15/yr direct.
//
// getFinancialData() used to hit SimpleFIN live on every call, and it isn't
// only the explicit "how am I doing financially" question — financeSignal()
// in lib/signals.js reads it too, riding inside buildRichContext(), which
// nearly every reasoning call in the system pulls in: a general question, a
// deep-thinking turn, the daily observer, ranking the news feed. Every one of
// those was a live bank API call nobody asked for, adding real latency to
// unrelated features.
//
// Now: one row in `finance_cache`, refreshed at most once every
// CACHE_MAX_AGE_HOURS. A wide window is always fetched and stored regardless
// of what any individual caller asked for, so a 7-day query and a 90-day
// query both slice the same cached data rather than needing their own cache
// entries — the public signature and return shape are unchanged, so every
// existing caller gets this for free.


const CACHE_MAX_AGE_HOURS = 12;

// Wide enough that every real caller's window (7, 30, 90 days) is a slice of
// what's cached, not a cache miss — and no wider, because SimpleFIN refuses
// anything past 90 days.
//
// This was 100, which asked for more history than SimpleFIN will serve. It
// returned the same 89 days either way, so no data was ever missing; what it
// cost was a permanent `errors` entry ("Requested date range exceeds limit of 90
// days and was capped") on every single fetch. Measured against the live API:
// 90 still trips that notice and 89 does not, so the real boundary is 89.
const CACHE_WINDOW_DAYS = 89;


// SimpleFIN's `errors` array is not only errors.
//
// Genuine per-institution problems arrive here — a bank needing re-auth is the
// one that matters — but so do advisories about the shape of *our own request*,
// and those fire on every call: any window over 45 days is commented on no
// matter what. That noise reached the user. It went into the finance model's
// prompt under "Bank connection warnings", which invites it to report a bank
// problem that does not exist, and it was the first line shown when the bank was
// genuinely unreachable. Worst of all it made a real re-auth warning
// indistinguishable from the permanent one nobody needs to read.
//
// Advisories are logged rather than dropped: if SimpleFIN ever does enforce the
// 45-day recommendation, the 90-day range on the money page stops being
// coverable, and this line in the logs is the warning shot.
function realWarnings(errors) {

  const all = (errors || []).map(String);

  const advisories = all.filter(e => /date range/i.test(e));

  if (advisories.length > 0) {
    console.warn("SIMPLEFIN REQUEST ADVISORY (not a bank problem):", advisories.join("; "));
  }

  return all.filter(e => !/date range/i.test(e));

}


function credentials() {

  const raw = process.env.SIMPLEFIN_ACCESS_URL;

  if (!raw) {
    throw new Error("Banking is not configured (missing SIMPLEFIN_ACCESS_URL).");
  }

  const url = new URL(raw);

  const auth = "Basic " + Buffer.from(
    `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
  ).toString("base64");

  return {
    auth,
    base: `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, "")
  };

}


// SimpleFIN sends amounts as decimal strings; coerce once, here, so no caller
// ever does string arithmetic on money.
function toNumber(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}


function missingTable(error) {
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}


// The actual network call. Always fetches CACHE_WINDOW_DAYS regardless of what
// the caller wanted — narrowing happens after, against the cached copy.
async function fetchLive() {

  const { auth, base } = credentials();

  const startDate = Math.floor((Date.now() - CACHE_WINDOW_DAYS * 86400 * 1000) / 1000);

  const response = await fetch(
    `${base}/accounts?start-date=${startDate}`,
    { headers: { Authorization: auth } }
  );

  if (!response.ok) {
    throw new Error(`SimpleFIN returned ${response.status}`);
  }

  const data = await response.json();

  // SimpleFIN reports per-institution problems here rather than failing the
  // request — a bank needing re-auth shows up as an error string while other
  // accounts still return fine. Advisories about our own query are stripped;
  // see realWarnings().
  const warnings = realWarnings(data.errors);

  const accounts = (data.accounts || []).map(account => ({
    id: account.id,
    org: account.org?.name || account.org?.domain || "Unknown",
    name: account.name,
    currency: account.currency || "USD",
    balance: toNumber(account.balance),
    availableBalance: account["available-balance"] != null
      ? toNumber(account["available-balance"])
      : null,
    transactions: (account.transactions || []).map(t => ({
      id: t.id,
      // `posted` is when it cleared, `transacted_at` when it happened; the
      // second is closer to the user's memory of it but isn't always present.
      // Stored as an ISO string — JSONB has no native date type, and a naive
      // round-trip through JSON.stringify would silently do the same thing.
      date: new Date((t.transacted_at || t.posted) * 1000).toISOString(),
      amount: toNumber(t.amount),
      description: t.description || t.payee || "(no description)",
      payee: t.payee || null,
      memo: t.memo || null,
      mcc: t.mcc || null
    }))
  }));

  return { accounts, warnings };

}


async function readCache() {

  const { data, error } = await supabase
    .from("finance_cache")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (missingTable(error)) return { row: null, migrationMissing: true };
    throw new Error(error.message);
  }

  return { row: data, migrationMissing: false };

}


async function writeCache(accounts, warnings) {

  // upsert against the constant-expression unique index (see
  // docs/schema-finance-cache.sql) rather than an id, since there is
  // deliberately only ever one row and no caller has it to hand.
  const { data: existing } = await supabase.from("finance_cache").select("id").limit(1).maybeSingle();

  const row = { payload: { accounts }, warnings, fetched_at: new Date().toISOString() };

  if (existing) {
    await supabase.from("finance_cache").update(row).eq("id", existing.id);
  } else {
    await supabase.from("finance_cache").insert([row]);
  }

}


// Exported for a pure, offline test — this is the part most likely to have a
// silent off-by-one (day math, ISO round-tripping) and the only part of this
// file testable without a live Supabase table.
export function sliceToWindow(payload, days) {

  const since = Date.now() - days * 86400 * 1000;

  return {
    accounts: payload.accounts.map(account => ({
      ...account,
      transactions: account.transactions
        .filter(t => new Date(t.date).getTime() >= since)
        // Rehydrate into real Date objects — every caller (finances.js,
        // metrics.js) already expects `date` to be a Date, exactly as the
        // uncached version always returned.
        .map(t => ({ ...t, date: new Date(t.date) }))
    }))
  };

}


export async function getFinancialData({ days = 30 } = {}) {

  const { row, migrationMissing } = await readCache();

  // Pre-migration: behave exactly as before caching existed, so this ships
  // without the SQL having been run yet and upgrades silently once it has.
  if (migrationMissing) {
    const fresh = await fetchLive();
    return { ...sliceToWindow(fresh, days), warnings: fresh.warnings, days, fetchedAt: new Date().toISOString(), cached: false };
  }

  const ageHours = row ? (Date.now() - new Date(row.fetched_at).getTime()) / 3_600_000 : Infinity;

  if (!row || ageHours >= CACHE_MAX_AGE_HOURS) {

    try {

      const fresh = await fetchLive();

      await writeCache(fresh.accounts, fresh.warnings).catch(error => {
        // A failed cache write must not cost the user their data for this
        // call — it just means the next call refreshes again instead of
        // reading a hit.
        console.error("FINANCE CACHE WRITE FAILED:", error.message);
      });

      return { ...sliceToWindow({ accounts: fresh.accounts }, days), warnings: fresh.warnings, days, fetchedAt: new Date().toISOString(), cached: false };

    } catch (error) {

      // The bank is unreachable and the cache is stale or missing. A stale
      // number honestly labelled is more useful than no number at all — fall
      // back to it rather than failing outright.
      if (row) {

        console.error("FINANCE LIVE REFRESH FAILED, serving stale cache:", error.message);

        return {
          ...sliceToWindow(row.payload, days),
          // Filtered on the way out as well as on the way in, so the rows
          // already sitting in finance_cache with the old advisory baked into
          // them stop surfacing it now rather than in twelve hours' time.
          warnings: [...realWarnings(row.warnings), `Couldn't refresh from the bank just now (${error.message}) — showing data from ${row.fetched_at}.`],
          days,
          fetchedAt: row.fetched_at,
          cached: true,
          stale: true
        };

      }

      throw error;

    }

  }

  return {
    ...sliceToWindow(row.payload, days),
    warnings: realWarnings(row.warnings),
    days,
    fetchedAt: row.fetched_at,
    cached: true
  };

}
