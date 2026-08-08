"use client";

import { useState } from "react";
import { Counted } from "./Reveal.js";
import MoneyAsk from "./MoneyAsk.js";
import { Card, SectionTitle, Empty, Meta } from "./ui.js";
import { SpendDonut, CategoryBars, RAMP } from "./MoneyCharts.js";
import { FINANCE_RANGE_LABELS } from "../lib/categorize.js";


// The whole money page below the title.
//
// It is one client component rather than a server page per range because
// switching range used to be a navigation: a fresh server render, and on a cold
// container a fresh model call to classify any merchant the narrower window had
// never contained. Every range now arrives in the one payload, so switching is
// local state and instant. See the note in the finance handler for why that is
// also strictly less work for the server, not a trade.
//
// Nothing here computes a figure. Every number rendered was summarised in
// lib/categorize.js on the server; this picks which pre-computed view to show
// and filters an already-categorised list for the drilldowns.


function money(n, { sign = false } = {}) {
  const v = Math.abs(Number(n) || 0);
  const s = v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
                      : v.toFixed(2);
  return `${sign && Number(n) < 0 ? "−" : sign ? "+" : ""}$${s}`;
}


// The same decision money() makes, as the pieces <Counted /> needs.
function moneyParts(n, { sign = false } = {}) {
  const v = Math.abs(Number(n) || 0);
  return {
    value: v,
    decimals: v >= 1000 ? 0 : 2,
    prefix: `${sign && Number(n) < 0 ? "−" : sign ? "+" : ""}$`
  };
}


function shortDate(iso) {
  // Parsed as parts rather than through Date, so a yyyy-MM-dd string is not
  // shifted a day west by being read as UTC midnight. Trap #1, again.
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


function StatFace({ label, amount, sign = false, tone = "ink", sub = null }) {
  const colour = tone === "moss" ? "text-moss" : "text-ink";
  const parts = moneyParts(amount, { sign });
  return (
    <span className="flex flex-col gap-1">
      <span className="text-[0.72rem] uppercase tracking-[0.08em] text-ink-soft">{label}</span>
      <Counted
        // Keyed by the value so a range switch re-runs the count-up rather than
        // leaving the previous range's figure frozen on screen: <Counted />
        // writes through a ref, so without a remount React has no reason to
        // touch the text it already wrote.
        key={parts.value}
        value={parts.value}
        prefix={parts.prefix}
        decimals={parts.decimals}
        className={`pos-data text-[1.35rem] leading-none ${colour}`}
      >
        {money(amount, { sign })}
      </Counted>
      {sub && <span className="text-[0.72rem] text-ink-soft">{sub}</span>}
    </span>
  );
}


function Stat(props) {
  return (
    <div className="px-4 py-3.5">
      <StatFace {...props} />
    </div>
  );
}


// A native <details> rather than a client-state disclosure: it needs nothing
// beyond open/closed, so there is no reason to ship JavaScript for it.
function Disclosure({ summary, children, className = "" }) {
  return (
    <details className={`group [&::-webkit-details-marker]:hidden ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:text-ink">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      {children}
    </details>
  );
}


// One row per transaction, used by every drilldown.
function TransactionRows({ rows }) {
  return (
    <div className="mt-2 space-y-1.5">
      {rows.map((t, i) => (
        <div key={`${t.date}-${t.merchant}-${i}`} className="flex items-baseline justify-between gap-3 text-[0.82rem]">
          <Meta className="w-11 shrink-0">{shortDate(t.date)}</Meta>
          <span className="min-w-0 flex-1 truncate text-ink-soft">{t.merchant}</span>
          <span className="pos-data shrink-0 text-ink">{money(t.amount)}</span>
        </div>
      ))}
    </div>
  );
}


export default function MoneyView({ data }) {

  const ranges = data.ranges || [30];

  const [days, setDays] = useState(ranges.includes(30) ? 30 : ranges[0]);

  const view = data.views?.[days] || data.views?.[ranges[0]];

  if (!view) {
    return <Empty>Nothing to show for this range.</Empty>;
  }

  const cutoff = data.cutoffs?.[days];

  // Everything in the active window, already categorised and newest-first from
  // the server. Filtering it is not arithmetic — the totals above come from
  // summarise(), never from adding these up here.
  const inRange = (data.transactions || []).filter(t => !cutoff || t.date >= cutoff);

  const forCategory = (name) => inRange.filter(t => t.category === name);

  const top = view.categories.slice(0, 7);
  const restCategories = view.categories.slice(7);

  const shownMerchants = 8;
  const restMerchants = view.merchants.slice(shownMerchants);

  const subscriptionTotal = view.recurring.reduce((t, r) => t + r.amount, 0);

  return (
    <>

      <div className="pos-reveal mb-5 flex flex-wrap items-center gap-2" data-reveal>
        <div className="flex gap-1 rounded-[var(--r-pill)] border border-[var(--line)] p-1">
          {ranges.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className={`rounded-[var(--r-pill)] px-3 py-1.5 text-[0.78rem] font-medium transition-colors ${
                days === r ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {FINANCE_RANGE_LABELS[r] || `${r} days`}
            </button>
          ))}
        </div>
      </div>

      {/* The four figures worth knowing before anything else. Net is the only
          one that gets colour, and only when it is positive — moss means
          settled, and ember is reserved app-wide for things awaiting you. */}
      <div className="pos-reveal" data-reveal>
        <Card className="mb-5 !p-0 overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] [&>*]:border-[var(--line)]">

            <details className="group px-4 py-3.5 [&::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none">
                <StatFace
                  label="Balance"
                  amount={data.totalBalance}
                  sub={`${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"} · tap for the split`}
                />
              </summary>
              <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3">
                {data.accounts.map(a => (
                  <div key={a.name} className="flex items-baseline justify-between gap-3 text-[0.85rem]">
                    <span className="min-w-0 truncate text-ink-soft">{a.name}</span>
                    <span className="pos-data shrink-0 text-ink">{money(a.balance)}</span>
                  </div>
                ))}
              </div>
            </details>

            <Stat label="Spent" amount={view.spent} sub={`${view.transactionCount} transactions`} />
            <Stat label="In" amount={view.earned} />
            <Stat label="Net" amount={view.net} sign tone={view.net >= 0 ? "moss" : "ink"} />

          </div>
        </Card>
      </div>

      {view.spent === 0 ? (

        <div className="pos-reveal mb-5" data-reveal>
          <Empty>Nothing spent in this window.</Empty>
        </div>

      ) : (

        <>
          <div className="pos-reveal" data-reveal>
            <Card className="mb-5">
              <SectionTitle>Where it went</SectionTitle>
              <SpendDonut key={`donut-${days}`} categories={top} total={view.spent} />
            </Card>
          </div>

          <div className="pos-reveal" data-reveal>
            <Card className="mb-5">
              <SectionTitle count={view.categories.length}>By category</SectionTitle>

              <CategoryBars key={`bars-${days}`} categories={top} max={top[0]?.total || 1} />

              {/* Every category opens into the transactions behind it. This is
                  the question a breakdown always raises and could not answer:
                  "$268 on transport" is only useful once you can see which
                  charges it is made of. */}
              <div className="mt-4 space-y-1 border-t border-[var(--line)] pt-3">
                {view.categories.map((c, i) => {
                  const rows = forCategory(c.name);
                  return (
                    <Disclosure
                      key={c.name}
                      summary={
                        <span className="flex flex-1 items-baseline justify-between gap-3">
                          <span className="capitalize">{c.name}</span>
                          <span className="pos-data text-ink">
                            {money(c.total)}
                            <span className="ml-2 text-ink-soft">{rows.length}</span>
                          </span>
                        </span>
                      }
                      className={i < 7 ? "" : "opacity-80"}
                    >
                      {rows.length > 0
                        ? <TransactionRows rows={rows} />
                        : <p className="mt-2 text-[0.8rem] text-ink-soft">
                            No individual charges in this window.
                          </p>}
                    </Disclosure>
                  );
                })}
              </div>

              {restCategories.length > 0 && (
                <p className="mt-3 text-[0.75rem] text-ink-soft">
                  The chart shows the top seven; the list above is all{" "}
                  {view.categories.length}.
                </p>
              )}
            </Card>
          </div>
        </>

      )}

      {view.merchants.length > 0 && (
        <div className="pos-reveal" data-reveal>
          <Card className="mb-5">
            <SectionTitle count={view.merchants.length}>Top merchants</SectionTitle>
            <div>
              {view.merchants.slice(0, shownMerchants).map((m, i) => (
                <div
                  key={m.merchant}
                  className="flex items-baseline gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0 first:pt-0"
                >
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: RAMP[Math.min(i, RAMP.length - 1)] }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.9rem] text-ink">{m.merchant}</span>
                  <Meta className="shrink-0">{m.count}&times;</Meta>
                  <span className="pos-data shrink-0 text-[0.9rem] text-ink">{money(m.total)}</span>
                </div>
              ))}
            </div>

            {restMerchants.length > 0 && (
              <Disclosure
                summary={`${restMerchants.length} more merchant${restMerchants.length === 1 ? "" : "s"}`}
                className="mt-3 border-t border-[var(--line)] pt-3"
              >
                <div className="mt-2 space-y-1.5">
                  {restMerchants.map(m => (
                    <div key={m.merchant} className="flex items-baseline justify-between gap-3 text-[0.85rem]">
                      <span className="min-w-0 truncate text-ink-soft">{m.merchant}</span>
                      <span className="pos-data shrink-0 text-ink">{money(m.total)} · {m.count}&times;</span>
                    </div>
                  ))}
                </div>
              </Disclosure>
            )}
          </Card>
        </div>
      )}

      {view.recurring.length > 0 && (
        <div className="pos-reveal" data-reveal>
          <Card className="mb-5">
            <SectionTitle count={view.recurring.length}>Repeating</SectionTitle>
            <p className="-mt-1 mb-3 text-[0.85rem] leading-relaxed text-ink-soft">
              Same merchant, same rough amount, more than once — {money(subscriptionTotal)} a
              cycle. This is the spending most worth re-deciding.
            </p>
            <div>
              {view.recurring.map(r => (
                <div
                  key={r.merchant}
                  className="flex items-baseline gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0 first:pt-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[0.9rem] text-ink">{r.merchant}</span>
                  <Meta className="shrink-0">{r.occurrences}&times;</Meta>
                  <span className="pos-data shrink-0 text-[0.9rem] text-ink">{money(r.amount)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {view.recent.length > 0 && (
        <div className="pos-reveal" data-reveal>
          <Card className="mb-5">
            <SectionTitle>Recent</SectionTitle>
            <div>
              {view.recent.map((t, i) => (
                <div
                  key={`${t.date}-${i}`}
                  className="flex items-baseline gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0 first:pt-0"
                >
                  <Meta className="w-12 shrink-0">{shortDate(t.date)}</Meta>
                  <span className="min-w-0 flex-1 truncate text-[0.9rem] text-ink">{t.merchant}</span>
                  <span className="pos-data shrink-0 text-[0.9rem] text-ink">
                    {money(t.amount, { sign: true })}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="pos-reveal" data-reveal>
        <Card>
          <SectionTitle>Ask about your money</SectionTitle>
          <p className="-mt-1 mb-3 text-[0.85rem] leading-relaxed text-ink-soft">
            Anything from &ldquo;how much did I spend on takeout&rdquo; to
            &ldquo;am I saving anything this month&rdquo; — answered from the
            real transactions above, out loud if you&apos;d rather listen.
          </p>
          <MoneyAsk days={days} />
        </Card>
      </div>

    </>
  );

}
