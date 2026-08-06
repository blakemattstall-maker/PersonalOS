// Real market prices, for a paper portfolio.
//
// The positions are imaginary; the prices are not. A fund whose P/L is also
// invented would be a random number generator with a narrator — the whole
// reason this is interesting is that the manager's bad calls are really bad.
//
// Yahoo's chart endpoint is used because it needs no key, no signup and no
// per-day quota, which matters for something that should keep working without
// maintenance. It is unofficial, so every caller must survive it disappearing:
// a missing quote holds the last known price and says so rather than marking a
// position to zero, which would look like a catastrophic loss.

const ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";

// Yahoo returns 429/403 to obviously-scripted clients with no UA.
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; PersonalOS/1.0)" };


export async function getQuote(symbol) {

  const url = `${ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

  const response = await fetch(url, { headers: HEADERS });

  if (!response.ok) {
    throw new Error(`Quote for ${symbol} failed: HTTP ${response.status}`);
  }

  const body = await response.json();

  const meta = body?.chart?.result?.[0]?.meta;

  if (!meta?.regularMarketPrice) {
    throw new Error(`No price returned for ${symbol}`);
  }

  const price = Number(meta.regularMarketPrice);
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose ?? price);

  return {
    symbol: meta.symbol || symbol,
    price,
    previousClose: previous,
    // Day change is what the dispatch actually talks about, and computing it
    // here means the model is never asked to do arithmetic it can get wrong.
    changePercent: previous ? ((price - previous) / previous) * 100 : 0,
    currency: meta.currency || "USD",
    name: meta.longName || meta.shortName || meta.symbol || symbol
  };

}


// Quotes for many symbols. Failures are returned rather than thrown so one
// delisted or mistyped ticker can't take down the whole morning run.
export async function getQuotes(symbols) {

  const unique = [...new Set(symbols.filter(Boolean))];

  const settled = await Promise.allSettled(unique.map(getQuote));

  const quotes = {};
  const failed = [];

  settled.forEach((result, i) => {
    if (result.status === "fulfilled") quotes[unique[i]] = result.value;
    else failed.push({ symbol: unique[i], error: result.reason?.message });
  });

  return { quotes, failed };

}


// Does this symbol actually exist and trade?
//
// The manager picks its own tickers, and a model asked for something obscure
// will confidently invent one. Buying a symbol that doesn't exist would produce
// a position that can never be priced again — permanently poisoning the P/L
// with a silent hole, which is exactly the failure mode worth spending a
// network call to avoid.
export async function validateSymbol(symbol) {

  try {
    const quote = await getQuote(symbol);
    return { valid: true, quote };
  } catch (error) {
    return { valid: false, error: error.message };
  }

}
