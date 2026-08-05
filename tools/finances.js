import openai from "../lib/openai.js";
import { DateTime } from "luxon";
import { getFinancialData } from "../lib/simplefin.js";
import { getUserTimezone, getProfileBio } from "../lib/profile.js";


// Every number here is computed in code, never by the model. Asking a language
// model to total a column and then narrate the result is how "you're behind on
// X" ended up contradicting itself mid-sentence earlier in this codebase — the
// arithmetic is exact work, so the model's job is prose about a figure that has
// already been decided.

const money = n => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;


function summarize(accounts, tz) {

  const all = accounts.flatMap(a => a.transactions);

  // Positive is money in, negative is money out — sum them separately rather
  // than netting, because "spent $1,400 while $1,500 came in" is a very
  // different fact from "net +$100".
  const spend = all.filter(t => t.amount < 0);
  const income = all.filter(t => t.amount > 0);

  const totalSpent = spend.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIn = income.reduce((s, t) => s + t.amount, 0);

  // Merchant names carry trailing store numbers, cities and dates, so the same
  // shop never groups. Trim to the leading words to make recurring spend visible.
  const key = t => (t.payee || t.description)
    .replace(/\d{2}\/\d{2}.*$/, "")
    .replace(/[#*]\s*\d+.*$/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ")
    .toUpperCase();

  const byMerchant = new Map();

  for (const t of spend) {
    const k = key(t);
    const entry = byMerchant.get(k) || { total: 0, count: 0 };
    entry.total += Math.abs(t.amount);
    entry.count += 1;
    byMerchant.set(k, entry);
  }

  const topMerchants = [...byMerchant.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 12);

  const largest = spend
    .slice()
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 8);

  return { totalSpent, totalIn, spendCount: spend.length, topMerchants, largest };

}


export async function queryFinances({ question, days = 30 } = {}) {

  const [tz, bio] = await Promise.all([
    getUserTimezone(),
    getProfileBio()
  ]);

  const { accounts, warnings } = await getFinancialData({ days });


  if (accounts.length === 0) {
    return {
      success: false,
      message: "I couldn't reach your bank right now." + (warnings.length ? ` ${warnings[0]}` : "")
    };
  }


  const s = summarize(accounts, tz);

  const netWorth = accounts.reduce((sum, a) => sum + a.balance, 0);


  const balances = accounts
    .map(a => `  ${a.org} ${a.name}: ${money(a.balance)}`)
    .join("\n");

  const merchants = s.topMerchants
    .map(([name, v]) => `  ${money(v.total)} across ${v.count}x — ${name}`)
    .join("\n");

  const biggest = s.largest
    .map(t => `  ${money(t.amount)} on ${DateTime.fromJSDate(t.date).setZone(tz).toFormat("MMM d")} — ${t.description.slice(0, 45)}`)
    .join("\n");


  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    messages: [

      {
        role: "system",

        content: `You are PersonalOS answering a question about the user's money.

Who you're talking to:
${bio || "(no profile saved yet)"}

ALL FIGURES BELOW ARE ALREADY CALCULATED. Use them exactly as given and never
add, re-total or estimate anything yourself.

Balances (total ${money(netWorth)}):
${balances}

Last ${days} days:
  Money in:    ${money(s.totalIn)}
  Money out:   ${money(s.totalSpent)}
  Net:         ${money(s.totalIn - s.totalSpent)}
  ${s.spendCount} purchases

Where it went:
${merchants || "  (nothing)"}

Largest single purchases:
${biggest || "  (none)"}
${warnings.length ? `\nBank connection warnings: ${warnings.join("; ")}` : ""}

RULES:
- Answer only from the figures above. Never invent a number or a merchant.
- The user has told you to be blunt and hold nothing back. If the spending
  contradicts something they've said they want, say so plainly — that is the
  single most useful thing you can do here. Do not moralise or lecture.
- You are not a licensed financial advisor and must not give investment advice.
  Describing their own spending back to them is fine; recommending what to do
  with investments is not.
- Plain text only. No markdown, no bullets, no headers.
- Brief and conversational — this is read aloud or shown on a phone.`
      },

      {
        role: "user",
        content: question || "How am I doing financially?"
      }

    ]

  });


  return {

    success: true,

    message: response.choices[0].message.content,

    data: {
      question,
      netWorth: Number(netWorth.toFixed(2)),
      totalSpent: Number(s.totalSpent.toFixed(2)),
      totalIn: Number(s.totalIn.toFixed(2)),
      transactionCount: s.spendCount,
      days,
      warnings
    }

  };

}
