import { DateTime } from "luxon";
import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";
import { getQuotes, validateSymbol } from "../lib/quotes.js";
import { getUserTimezone } from "../lib/profile.js";


// The Fund.
//
// A paper portfolio with a personality, capitalised by the user's own
// failures. Miss a deadline and ten virtual dollars land here, where an
// eccentric manager does something ill-advised with them and files a dispatch
// about it in the morning.
//
// Positions are paper; prices are real. That split is deliberate. A fund with
// invented prices is a random number generator with a narrator — the manager's
// bad calls have to actually be bad, against real quotes, or none of it lands.
// And nothing is ever ordered anywhere: the app decides and reports, and if a
// call looks good the user places it himself. Code that submits real orders off
// the back of "did Blake go to the gym" is a bad idea however small the amount.
//
// The purpose is NOT behaviour change and it is not pretending to be. It turns
// a missed workout into a plot development instead of a scolding, which is a
// thing a personal system can do that a habit tracker cannot.


function missingTable(error) {
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}


// A bad week must not produce an absurd number. The joke stops being funny at
// four figures and the arithmetic stops being interesting.
const DAILY_DEPOSIT_CAP = 50;


// ---------------------------------------------------------------------------
// The manager
// ---------------------------------------------------------------------------

async function inventManager() {

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Invent a fund manager for a very small, very strange paper
portfolio. It is capitalised entirely by its client's personal failures —
every missed deadline and skipped workout deposits ten dollars.

The manager should be genuinely odd and genuinely coherent. Not "quirky
assistant" odd — someone with a real, specific, defensible-but-unfashionable
worldview about markets, who would be insufferable at a dinner party and
occasionally right. Think a niche newsletter nobody should be reading.

It must NOT be a generic index-fund rationalist, and it must not be a reckless
degenerate gambler. Both are boring. Give it an actual thesis with a mechanism
behind it.

It knows exactly where its capital comes from and has opinions about that.

Return ONLY JSON:
{
  "manager_name": "a name with a little dignity to lose",
  "manager_voice": "2-3 sentences on how it writes — cadence, verbal tics, what it is smug about, what it refuses to discuss",
  "thesis": "3-4 sentences: its actual investing worldview and the mechanism it believes in. Specific enough to generate real decisions."
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


export async function getAccount() {

  const { data, error } = await supabase
    .from("fund_account")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (missingTable(error)) return null;
    throw new Error(error.message);
  }

  if (data) return data;

  // First run — hire someone.
  const manager = await inventManager();

  const { data: created, error: createError } = await supabase
    .from("fund_account")
    .insert([{
      cash: 0,
      total_deposited: 0,
      manager_name: manager.manager_name,
      manager_voice: manager.manager_voice,
      thesis: manager.thesis,
      thesis_set_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (createError) throw new Error(createError.message);

  return created;

}


// ---------------------------------------------------------------------------
// What the user did wrong
// ---------------------------------------------------------------------------
//
// Deliberately deterministic, in code, not decided by a model. The user needs
// to be able to look at a deposit and know exactly which of his own failures
// paid for it — "the AI felt you'd been sloppy" is not a funding event.
//
// Every trigger carries a stable key so the daily run is idempotent: the same
// missed workout can never be charged twice, however many times this runs.

async function evaluateTriggers(tz) {

  const today = DateTime.now().setZone(tz);
  const todayKey = today.toFormat("yyyy-MM-dd");

  const triggers = [];


  // Tasks finished late — the clearest, most objective failure available.
  const { data: lateCompletions } = await supabase
    .from("activity_logs")
    .select("input, output, created_at")
    .eq("action", "task_completed")
    .gte("created_at", today.minus({ days: 1 }).startOf("day").toISO());

  for (const log of lateCompletions || []) {

    const daysLate = log.output?.days_late ?? 0;

    if (daysLate <= 0) continue;

    triggers.push({
      key: `late:${log.created_at}`,
      amount: 10,
      note: `Finished something ${daysLate} day${daysLate === 1 ? "" : "s"} late: ${String(log.input).slice(0, 60)}`
    });

  }


  // Anything currently past due. Once a day regardless of how many, because
  // charging per overdue task turns one bad week into a rent payment.
  const { data: overdue } = await supabase
    .from("tasks")
    .select("title")
    .neq("status", "completed")
    .not("due_date", "is", null)
    .lt("due_date", todayKey);

  if (overdue?.length) {
    triggers.push({
      key: `overdue:${todayKey}`,
      amount: 5,
      note: `${overdue.length} task${overdue.length === 1 ? "" : "s"} sitting past due`
    });
  }


  // Said he'd weigh in and hasn't for a week.
  const { data: lastWeight } = await supabase
    .from("bodyweight_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  const lastWeighIn = lastWeight?.[0]?.created_at;

  if (lastWeighIn && today.diff(DateTime.fromISO(lastWeighIn), "days").days >= 7) {
    triggers.push({
      key: `no_weigh_in:${todayKey}`,
      amount: 5,
      note: "No weigh-in for a week"
    });
  }


  // People he said he'd stay in touch with, and hasn't.
  const { data: quiet } = await supabase
    .from("people")
    .select("id, name")
    .lte("next_check_in_at", new Date().toISOString());

  for (const person of quiet || []) {
    triggers.push({
      key: `quiet:${person.id}:${todayKey}`,
      amount: 5,
      note: `Overdue on checking in with ${person.name}`
    });
  }


  return triggers;

}


async function applyDeposits(account, triggers) {

  let deposited = 0;

  const applied = [];

  for (const trigger of triggers) {

    if (deposited + trigger.amount > DAILY_DEPOSIT_CAP) break;

    // The unique index on trigger_key is the real guard — a check-then-insert
    // would still double-charge on a concurrent or retried run.
    const { error } = await supabase.from("fund_events").insert([{
      kind: "deposit",
      amount: trigger.amount,
      note: trigger.note,
      trigger_key: trigger.key
    }]);

    if (error) {
      if (error.code === "23505") continue;   // already charged, fine
      throw new Error(error.message);
    }

    deposited += trigger.amount;
    applied.push(trigger);

  }

  if (deposited > 0) {

    await supabase
      .from("fund_account")
      .update({
        cash: Number(account.cash) + deposited,
        total_deposited: Number(account.total_deposited) + deposited,
        updated_at: new Date().toISOString()
      })
      .eq("id", account.id);

  }

  return { deposited, applied };

}


// ---------------------------------------------------------------------------
// Positions and valuation
// ---------------------------------------------------------------------------

export async function getPositions() {

  const { data, error } = await supabase.from("fund_positions").select("*");

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }

  return data || [];

}


export async function getFundSnapshot() {

  const account = await getAccount();

  if (!account) return null;

  const positions = await getPositions();

  const { quotes, failed } = await getQuotes(positions.map(p => p.symbol));

  let marketValue = 0;

  const priced = positions.map(p => {

    const quote = quotes[p.symbol];

    // A quote that failed holds cost basis rather than marking to zero, which
    // would read as a total loss instead of "we couldn't reach the price feed".
    const price = quote?.price ?? Number(p.avg_cost);

    const value = Number(p.shares) * price;
    const cost = Number(p.shares) * Number(p.avg_cost);

    marketValue += value;

    return {
      ...p,
      price,
      stale: !quote,
      name: quote?.name || p.symbol,
      dayChangePercent: quote?.changePercent ?? 0,
      value,
      gain: value - cost,
      gainPercent: cost ? ((value - cost) / cost) * 100 : 0
    };

  });

  const total = marketValue + Number(account.cash);
  const deposited = Number(account.total_deposited);

  return {
    account,
    positions: priced.sort((a, b) => b.value - a.value),
    cash: Number(account.cash),
    marketValue,
    total,
    deposited,
    gain: total - deposited,
    gainPercent: deposited ? ((total - deposited) / deposited) * 100 : 0,
    staleSymbols: failed.map(f => f.symbol)
  };

}


// ---------------------------------------------------------------------------
// The daily run
// ---------------------------------------------------------------------------

async function decide({ account, snapshot, newDeposits, watchQuotes }) {

  const holdings = snapshot.positions.length
    ? snapshot.positions.map(p =>
        `${p.symbol}: ${Number(p.shares).toFixed(4)} sh @ avg $${Number(p.avg_cost).toFixed(2)}, now $${p.price.toFixed(2)} (${p.gainPercent >= 0 ? "+" : ""}${p.gainPercent.toFixed(1)}%). Bought because: ${p.thesis || "unrecorded"}`
      ).join("\n")
    : "(nothing held yet)";

  const market = Object.values(watchQuotes)
    .map(q => `${q.symbol} $${q.price.toFixed(2)} (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% today)`)
    .join("\n");

  const funding = newDeposits.length
    ? newDeposits.map(d => `$${d.amount} — ${d.note}`).join("\n")
    : "(no new capital today)";

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `You are ${account.manager_name}, managing a very small paper
portfolio for one client.

How you write:
${account.manager_voice}

Your thesis:
${account.thesis}

EVERY DOLLAR HERE CAME FROM THE CLIENT FAILING AT SOMETHING. New capital
arrived today because of:
${funding}

Cash available: $${snapshot.cash.toFixed(2)}
Current holdings:
${holdings}

Real prices right now:
${market}

Decide what to do today, then write the morning dispatch.

Rules that are not negotiable:
- You may only buy symbols from the "Real prices" list above. Do not invent a
  ticker; anything not on that list will be rejected.
- Never spend more cash than you have. Total buys must be under $${snapshot.cash.toFixed(2)}.
- Doing nothing is a legitimate and frequent choice. A manager who trades every
  single day is not following a thesis, he is fidgeting.
- Sizing is in dollars, not shares. Fractional shares are fine.

The dispatch is the actual product. It is read over breakfast by someone who
finds this funny. Be in character, be specific about real numbers you were
given (never invent one), and reference where the money came from when it's
worth a jab. Two short paragraphs at most. Do not explain what a stock is, do
not add disclaimers, and do not give the client financial advice — you are
managing imaginary money and you both know it.

Return ONLY JSON:
{
  "headline": "under 60 characters, in voice",
  "dispatch": "the morning note",
  "trades": [
    { "action": "buy" | "sell", "symbol": "TICKER", "amount_usd": 25.00, "reason": "one clause, in voice" }
  ]
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


// A watchlist wide enough to give the manager real choices without turning the
// morning run into a market-data crawl. Deliberately mixed: index, metals,
// crypto, a few large caps, some volatility — enough for most theses to find
// something to be wrong about.
const WATCHLIST = [
  "SPY", "QQQ", "GLD", "SLV", "TLT", "BTC-USD", "ETH-USD",
  "NVDA", "AAPL", "MSFT", "TSLA", "AMD", "KO", "XOM", "JNJ", "URA", "ARKK"
];


async function executeTrades({ account, trades, quotes }) {

  const executed = [];
  const rejected = [];

  let cash = Number(account.cash);

  for (const trade of trades || []) {

    const symbol = String(trade.symbol || "").toUpperCase();
    const amount = Number(trade.amount_usd);

    if (!symbol || !Number.isFinite(amount) || amount <= 0) {
      rejected.push({ trade, reason: "malformed" });
      continue;
    }

    let quote = quotes[symbol];

    // Off-watchlist picks get one validation call rather than a flat refusal —
    // the manager having a genuine idea is the point. An invented ticker still
    // gets rejected, which is what the check is for.
    if (!quote) {
      const check = await validateSymbol(symbol);
      if (!check.valid) {
        rejected.push({ trade, reason: `no such symbol: ${symbol}` });
        continue;
      }
      quote = check.quote;
    }

    const { data: existing } = await supabase
      .from("fund_positions")
      .select("*")
      .eq("symbol", symbol)
      .maybeSingle();


    if (trade.action === "buy") {

      if (amount > cash) {
        rejected.push({ trade, reason: `only $${cash.toFixed(2)} available` });
        continue;
      }

      const shares = amount / quote.price;

      if (existing) {

        const totalShares = Number(existing.shares) + shares;
        const totalCost = Number(existing.shares) * Number(existing.avg_cost) + amount;

        await supabase.from("fund_positions").update({
          shares: totalShares,
          avg_cost: totalCost / totalShares,
          updated_at: new Date().toISOString()
        }).eq("id", existing.id);

      } else {

        await supabase.from("fund_positions").insert([{
          symbol,
          shares,
          avg_cost: quote.price,
          thesis: trade.reason || null
        }]);

      }

      cash -= amount;

      await supabase.from("fund_events").insert([{
        kind: "buy", symbol, shares, price: quote.price, amount, note: trade.reason || null
      }]);

      executed.push({ ...trade, symbol, shares, price: quote.price });

      continue;

    }


    if (trade.action === "sell") {

      if (!existing) {
        rejected.push({ trade, reason: `nothing held in ${symbol}` });
        continue;
      }

      const held = Number(existing.shares) * quote.price;
      const proceeds = Math.min(amount, held);
      const shares = proceeds / quote.price;

      const remaining = Number(existing.shares) - shares;

      // Dust left by floating-point division would otherwise linger as a
      // position worth $0.0000001 forever.
      if (remaining <= 1e-8) {
        await supabase.from("fund_positions").delete().eq("id", existing.id);
      } else {
        await supabase.from("fund_positions").update({
          shares: remaining,
          updated_at: new Date().toISOString()
        }).eq("id", existing.id);
      }

      cash += proceeds;

      await supabase.from("fund_events").insert([{
        kind: "sell", symbol, shares, price: quote.price, amount: proceeds, note: trade.reason || null
      }]);

      executed.push({ ...trade, symbol, shares, price: quote.price, amount: proceeds });

      continue;

    }

    rejected.push({ trade, reason: `unknown action: ${trade.action}` });

  }

  if (cash !== Number(account.cash)) {
    await supabase.from("fund_account")
      .update({ cash, updated_at: new Date().toISOString() })
      .eq("id", account.id);
  }

  return { executed, rejected, cash };

}


export async function runFundDay({ force = false } = {}) {

  const tz = await getUserTimezone();

  const account = await getAccount();

  if (!account) {
    return { success: false, needsMigration: "docs/schema-fund.sql" };
  }

  // One dispatch a day. The fund is a side plot, not a feed.
  const todayStart = DateTime.now().setZone(tz).startOf("day").toISO();

  const { data: alreadyToday } = await supabase
    .from("fund_dispatches")
    .select("id")
    .gte("created_at", todayStart)
    .limit(1);

  if (alreadyToday?.length && !force) {
    return { success: true, skipped: "already filed today's dispatch" };
  }


  const triggers = await evaluateTriggers(tz);

  const { deposited, applied } = await applyDeposits(account, triggers);

  // Re-read: applyDeposits moved the cash balance.
  const fresh = await getAccount();

  const snapshot = await getFundSnapshot();

  const { quotes } = await getQuotes([...WATCHLIST, ...snapshot.positions.map(p => p.symbol)]);

  const plan = await decide({
    account: fresh,
    snapshot,
    newDeposits: applied,
    watchQuotes: quotes
  });

  const { executed, rejected } = await executeTrades({
    account: fresh,
    trades: plan.trades,
    quotes
  });

  const after = await getFundSnapshot();

  const { data: dispatch } = await supabase.from("fund_dispatches").insert([{
    headline: plan.headline,
    content: plan.dispatch,
    snapshot: {
      total: after.total,
      cash: after.cash,
      deposited: after.deposited,
      gainPercent: after.gainPercent,
      positions: after.positions.map(p => ({
        symbol: p.symbol, shares: p.shares, value: p.value, gainPercent: p.gainPercent
      })),
      executed,
      rejected,
      depositedToday: deposited
    }
  }]).select().single();

  return {
    success: true,
    deposited,
    triggers: applied,
    executed,
    rejected,
    headline: plan.headline,
    dispatch: plan.dispatch,
    total: after.total,
    dispatch_id: dispatch?.id
  };

}


export async function getRecentDispatches({ limit = 20 } = {}) {

  const { data, error } = await supabase
    .from("fund_dispatches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }

  return data || [];

}
