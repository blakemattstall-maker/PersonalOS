// Putting transactions into categories the bank does not provide.
//
// SimpleFIN passes through whatever the institution sends, and Chase sends
// `mcc: null` on every row. So there is no category to read — only a payee, a
// raw description and an amount. Everything a spending breakdown needs has to
// be derived from those three fields.
//
// Rules first, model second, and that order is the whole design. A rule is
// free, instant, deterministic and inspectable; it gets the same answer every
// time the dashboard loads, which matters because a pie chart that quietly
// reshuffles between refreshes is worse than no pie chart. The model only ever
// sees payees no rule matched, and its answers are cached by payee so each
// unfamiliar merchant costs one classification ever, not one per page load.

export const CATEGORIES = [
  "groceries",
  "eating out",
  "transport",
  "shopping",
  "subscriptions",
  "health",
  "education",
  "housing",
  "business",
  "transfers",
  "income",
  "other"
];


// Matched against payee and description together, in order. First hit wins, so
// the specific patterns come before the general ones.
const RULES = [

  [/\b(anthropic|openai|github|vercel|supabase|adobe|figma|notion|spotify|netflix|hulu|icloud|apple\.com\/bill|google \*|prime video|chatgpt)\b/i, "subscriptions"],

  [/\b(uber eats|doordash|grubhub|chipotle|mcdonald|starbucks|dunkin|chick-fil-a|panera|pizza|taco|restaurant|cafe|coffee|bar & grill|jimmy john)\b/i, "eating out"],

  // Fuel before groceries, deliberately: "Costco Gas" hit the costco grocery
  // rule and was filed as food. Warehouse clubs sell petrol under the same name.
  [/\b(uber|lyft|shell|chevron|exxon|bp |arco|76 |gas|parking|metra|cta |transit|hertz|enterprise rent|avis|delta|united air|american air|southwest)\b/i, "transport"],

  [/\b(trader joe|whole foods|safeway|kroger|aldi|costco|walmart|target|jewel|hy-vee|publix|grocer|market)\b/i, "groceries"],

  [/\b(amazon|amzn|best buy|ebay|etsy|nike|lululemon|uniqlo|zara|h&m|shein|nordstrom)\b/i, "shopping"],

  [/\b(cvs|walgreens|rite aid|pharmacy|dental|dentist|clinic|hospital|gym|planet fitness|lifetime|anytime fitness|supplement|gnc)\b/i, "health"],

  [/\b(university|college|tuition|bursar|textbook|chegg|coursera|student loan|nelnet|mohela|sallie mae)\b/i, "education"],

  [/\b(rent|landlord|property|apartment|electric|gas bill|water bill|internet|xfinity|comcast|at&t|verizon|t-mobile)\b/i, "housing"],

  [/\b(shopify|squarespace|namecheap|godaddy|stripe|printful|alibaba|fragrance|packaging)\b/i, "business"],

  [/\b(transfer|zelle|venmo|cash app|paypal|withdrawal|deposit to|atm)\b/i, "transfers"]

];


export function categorizeByRule(transaction) {

  // A credit is income unless it is plainly a transfer between his own
  // accounts, which is movement rather than earnings and would otherwise
  // inflate every income figure on the dashboard.
  const haystack = `${transaction.payee || ""} ${transaction.description || ""}`;

  if (Number(transaction.amount) > 0) {
    return /\b(transfer|from savings|to checking|zelle|venmo)\b/i.test(haystack) ? "transfers" : "income";
  }

  for (const [pattern, category] of RULES) {
    if (pattern.test(haystack)) return category;
  }

  return null;

}


// Normalised merchant name, used both as the cache key for classification and
// as the label a person actually recognises. "ANTHROPIC* CLAUDE SU
// ANTHROPIC.COM CA 08/03" is not a merchant name.
export function merchantOf(transaction) {

  const raw = (transaction.payee || transaction.description || "unknown").trim();

  return raw
    .replace(/\s+\d{2}\/\d{2}\s*$/, "")       // trailing posting date
    .replace(/\*+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\b\d{4,}\b/g, "")               // card/ref numbers
    .trim()
    .slice(0, 40) || "unknown";

}


// Classifies a whole batch. Returns the transactions with a `category` and a
// tidy `merchant`, plus which ones needed the model — so the caller can see how
// much of the breakdown is deterministic.
export async function categorizeTransactions(transactions, { classifyUnknown = null } = {}) {

  const out = [];

  const unmatched = new Map();

  for (const t of transactions) {

    const merchant = merchantOf(t);

    const category = categorizeByRule(t);

    out.push({ ...t, merchant, category });

    if (!category) {
      if (!unmatched.has(merchant)) unmatched.set(merchant, []);
      unmatched.get(merchant).push(out.length - 1);
    }

  }


  if (unmatched.size > 0 && classifyUnknown) {

    const guessed = await classifyUnknown([...unmatched.keys()]).catch(() => ({}));

    for (const [merchant, indexes] of unmatched) {

      const category = CATEGORIES.includes(guessed[merchant]) ? guessed[merchant] : "other";

      for (const i of indexes) out[i].category = category;

    }

  } else {

    for (const indexes of unmatched.values()) {
      for (const i of indexes) out[i].category = "other";
    }

  }


  return { transactions: out, unmatchedMerchants: [...unmatched.keys()] };

}


// Everything the dashboard displays, computed here rather than in the page or
// by a model. Money is the one place in this app where a number being subtly
// wrong is not a cosmetic problem.
// The ranges the money page offers, in one place so the API and the switcher
// cannot drift apart.
//
// 90 is the ceiling because lib/simplefin.js caches a 100-day window; a "year"
// option would either silently clamp or claim a span the data does not cover.
export const FINANCE_RANGES = [7, 30, 90];

export const FINANCE_RANGE_LABELS = { 7: "Week", 30: "Month", 90: "90 days" };


export function summarise(transactions) {

  let spent = 0;
  let earned = 0;

  const byCategory = {};
  const byMerchant = {};

  for (const t of transactions) {

    const amount = Number(t.amount) || 0;

    if (t.category === "transfers") continue;

    if (amount > 0) {
      earned += amount;
      continue;
    }

    const magnitude = Math.abs(amount);

    spent += magnitude;

    byCategory[t.category] = (byCategory[t.category] || 0) + magnitude;

    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = { merchant: t.merchant, total: 0, count: 0, category: t.category };
    byMerchant[t.merchant].total += magnitude;
    byMerchant[t.merchant].count += 1;

  }

  const round = (n) => Math.round(n * 100) / 100;

  const categories = Object.entries(byCategory)
    .map(([name, total]) => ({
      name,
      total: round(total),
      share: spent > 0 ? Math.round((total / spent) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.total - a.total);

  const merchants = Object.values(byMerchant)
    .map(m => ({ ...m, total: round(m.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    spent: round(spent),
    earned: round(earned),
    net: round(earned - spent),
    categories,
    merchants,
    transactionCount: transactions.filter(t => t.category !== "transfers").length
  };

}


// Charges from the same merchant, at a similar amount, showing up on a roughly
// monthly rhythm. Worth naming separately because subscriptions are the
// spending people most consistently forget they agreed to.
export function findRecurring(transactions) {

  const groups = {};

  for (const t of transactions) {
    if (Number(t.amount) >= 0) continue;
    (groups[t.merchant] ||= []).push(t);
  }

  const recurring = [];

  for (const [merchant, rows] of Object.entries(groups)) {

    if (rows.length < 2) continue;

    const amounts = rows.map(r => Math.abs(Number(r.amount)));

    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    // Within 15% of each other counts as "the same charge" — enough to absorb
    // a usage-based bill without swallowing genuinely different purchases at
    // the same shop.
    const consistent = amounts.every(a => Math.abs(a - average) <= average * 0.15);

    if (!consistent) continue;

    recurring.push({
      merchant,
      amount: Math.round(average * 100) / 100,
      occurrences: rows.length,
      category: rows[0].category,
      monthlyCost: Math.round(average * 100) / 100
    });

  }

  return recurring.sort((a, b) => b.amount - a.amount);

}


// The model fallback, for merchants no rule knows.
//
// Kept behind the rules on purpose — on live data the rules already place
// roughly two thirds of spending, and this only ever sees the remainder. The
// answers are cached by merchant name for the life of the container, so an
// unfamiliar shop costs one classification rather than one per page load, and
// the same merchant can never drift between categories inside a session.
const learned = new Map();


export async function classifyUnknownMerchants(merchants) {

  const unknown = merchants.filter(m => !learned.has(m));

  if (unknown.length > 0) {

    const [{ default: openai }, { MODELS }] = await Promise.all([
      import("./openai.js"),
      import("./models.js")
    ]);

    const response = await openai.chat.completions.create({

      model: MODELS.EXTRACT,

      response_format: { type: "json_object" },

      messages: [
        {
          role: "system",
          content:
            `Classify each merchant into exactly one category from this list:\n` +
            `${CATEGORIES.join(", ")}\n\n` +
            `These are personal card transactions from a US bank account. ` +
            `Use "other" only when the merchant is genuinely unidentifiable — a guess ` +
            `that is probably right beats "other", because "other" is what makes a ` +
            `spending breakdown useless.\n\n` +
            `Return ONLY JSON: {"merchant name": "category", ...} with a key for every ` +
            `merchant given, spelled exactly as provided.`
        },
        { role: "user", content: unknown.join("\n") }
      ]

    });

    let guessed = {};

    try {
      guessed = JSON.parse(response.choices[0].message.content);
    } catch {
      guessed = {};
    }

    for (const merchant of unknown) {
      learned.set(merchant, CATEGORIES.includes(guessed[merchant]) ? guessed[merchant] : "other");
    }

  }

  return Object.fromEntries(merchants.map(m => [m, learned.get(m) || "other"]));

}
