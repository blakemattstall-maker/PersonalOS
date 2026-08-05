// SimpleFIN client.
//
// Read-only by construction — the access URL grants balances and transactions
// and nothing that can move money. Chosen over Plaid, which is priced and
// shaped for companies rather than one person, at $15/yr direct.
//
// The access URL embeds its own credentials in userinfo, so it is a secret in
// the same class as SUPABASE_SERVICE_KEY: never log it, never return it.
//
// Follows the same shape as the Google integrations — read live at query time
// rather than mirroring into Supabase. Financial history lives at SimpleFIN,
// a local copy would only be one more thing to drift, and it means this
// needed no new table (Supabase DDL isn't reachable through PostgREST anyway).

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


export async function getFinancialData({ days = 30 } = {}) {

  const { auth, base } = credentials();

  const startDate = Math.floor((Date.now() - days * 86400 * 1000) / 1000);

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
  // accounts still return fine.
  const warnings = data.errors || [];

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
      date: new Date((t.transacted_at || t.posted) * 1000),
      amount: toNumber(t.amount),
      description: t.description || t.payee || "(no description)",
      payee: t.payee || null,
      memo: t.memo || null,
      mcc: t.mcc || null
    }))
  }));

  return { accounts, warnings, days };

}
