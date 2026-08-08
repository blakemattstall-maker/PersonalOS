import { backendGet } from "../backend.js";
import Reveal, { Counted } from "../Reveal.js";
import { Page, PageHeader, Card, SectionTitle, Empty, Meta } from "../ui.js";
import { SpendDonut, CategoryBars, RAMP } from "../MoneyCharts.js";


export const dynamic = "force-dynamic";
export const maxDuration = 60;


async function getFinance(days) {
  try {
    return await backendGet(`/api/finance?days=${days}`);
  } catch (error) {
    return { success: false, error: error.message };
  }
}


// Money is read at a glance, so the figures are set in the data face and every
// one of them is computed server-side in lib/categorize.js. Nothing on this
// page does arithmetic, and no model produced any number here.
function money(n, { sign = false } = {}) {
  const v = Math.abs(Number(n) || 0);
  const s = v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
                      : v.toFixed(2);
  return `${sign && Number(n) < 0 ? "−" : sign ? "+" : ""}$${s}`;
}


// The same decision `money()` makes, expressed as the pieces <Counted /> needs.
// It has to be described rather than passed as a formatter because this is a
// server component and a function cannot cross that boundary — see Reveal.js.
function moneyParts(n, { sign = false } = {}) {
  const v = Math.abs(Number(n) || 0);
  return {
    value: v,
    decimals: v >= 1000 ? 0 : 2,
    prefix: `${sign && Number(n) < 0 ? "−" : sign ? "+" : ""}$`
  };
}


function Stat({ label, amount, sign = false, tone = "ink", sub = null }) {
  const colour = tone === "moss" ? "text-moss" : "text-ink";
  const parts = moneyParts(amount, { sign });
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-[0.72rem] uppercase tracking-[0.08em] text-ink-soft">{label}</span>
      <Counted
        value={parts.value}
        prefix={parts.prefix}
        decimals={parts.decimals}
        className={`pos-data text-[1.35rem] leading-none ${colour}`}
      >
        {money(amount, { sign })}
      </Counted>
      {sub && <span className="text-[0.72rem] text-ink-soft">{sub}</span>}
    </div>
  );
}


export default async function Money() {

  const days = 30;

  const f = await getFinance(days);

  if (!f.success) {
    return (
      <Page>
        <PageHeader title="Money" />
        <Empty>
          Couldn&apos;t reach your bank connection. Check Settings for what&apos;s down —
          nothing here is cached long enough to show you stale figures instead.
        </Empty>
      </Page>
    );
  }

  const top = f.categories.slice(0, 7);

  const subscriptionTotal = f.recurring.reduce((t, r) => t + r.amount, 0);

  return (
    <Page>

      <PageHeader title="Money">
        The last {f.days} days, from your accounts directly. Balances are live;
        spending is categorised here because your bank sends no category at all.
      </PageHeader>

      {/* The four figures worth knowing before anything else. Net is the only
          one that gets colour, and only when it is positive — moss means
          settled, and ember is reserved app-wide for things awaiting him. */}
      <Reveal gap={70}>

      <div className="pos-reveal" data-reveal>
      <Card className="mb-5 !p-0 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] [&>*]:border-[var(--line)]">
          <Stat label="Balance" amount={f.totalBalance} sub={`${f.accounts.length} accounts`} />
          <Stat label="Spent" amount={f.spent} sub={`${f.transactionCount} transactions`} />
          <Stat label="In" amount={f.earned} />
          <Stat
            label="Net"
            amount={f.net}
            sign
            tone={f.net >= 0 ? "moss" : "ink"}
          />
        </div>
      </Card>
      </div>

      {f.spent === 0 ? (

        <Empty>Nothing spent in the last {f.days} days.</Empty>

      ) : (

        <>
          <div className="pos-reveal" data-reveal>
          <Card className="mb-5">
            <SectionTitle>Where it went</SectionTitle>
            <SpendDonut categories={top} total={f.spent} />
          </Card>
          </div>

          <div className="pos-reveal" data-reveal>
          <Card className="mb-5">
            <SectionTitle count={f.categories.length}>By category</SectionTitle>
            <CategoryBars categories={top} max={top[0]?.total || 1} />
          </Card>
          </div>
        </>

      )}

      {f.merchants.length > 0 && (
        <div className="pos-reveal" data-reveal>
        <Card className="mb-5">
          <SectionTitle count={f.merchants.length}>Top merchants</SectionTitle>
          <div>
            {f.merchants.slice(0, 8).map((m, i) => (
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
        </Card>
        </div>
      )}

      {f.recurring.length > 0 && (
        <div className="pos-reveal" data-reveal>
        <Card className="mb-5">
          <SectionTitle count={f.recurring.length}>Repeating</SectionTitle>
          <p className="-mt-1 mb-3 text-[0.85rem] leading-relaxed text-ink-soft">
            Same merchant, same rough amount, more than once — {money(subscriptionTotal)} a
            cycle. This is the spending most worth re-deciding.
          </p>
          <div>
            {f.recurring.map(r => (
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

      {f.recent.length > 0 && (
        <div className="pos-reveal" data-reveal>
        <Card>
          <SectionTitle>Recent</SectionTitle>
          <div>
            {f.recent.map((t, i) => (
              <div
                key={`${t.date}-${i}`}
                className="flex items-baseline gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0 first:pt-0"
              >
                <Meta className="w-12 shrink-0">
                  {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Meta>
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

      </Reveal>

      <p className="mt-6 text-[0.78rem] text-ink-soft">
        Pulled {f.cached ? "from cache" : "live"} · one bank call per 12 hours, sliced locally.
      </p>

    </Page>
  );

}
