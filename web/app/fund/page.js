import Link from "next/link";
import { backendGet } from "../backend.js";
import RunFundButton from "../RunFundButton.js";
import { formatDate } from "../shared.js";


export const dynamic = "force-dynamic";
export const maxDuration = 60;


const money = (n) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toFixed(2)}`;

const pct = (n) =>
  `${Number(n) >= 0 ? "+" : ""}${(Number(n) || 0).toFixed(1)}%`;


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


export default async function Fund() {

  const data = await safeGet("/api/fund", { success: false, dispatches: [] });

  const dispatches = data.dispatches || [];
  const positions = data.positions || [];

  const up = Number(data.gain) >= 0;

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">The Fund</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Back
          </Link>
        </div>

        {data.needsMigration ? (

          <div className="mt-6 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            <p>
              Not set up yet — run{" "}
              <code className="text-foreground">docs/schema-fund.sql</code> in
              Supabase, then press Run below.
            </p>
          </div>

        ) : !data.success ? (

          <p className="mt-6 text-sm text-muted">Couldn&apos;t reach the fund.</p>

        ) : (

          <>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Paper positions, real prices. Every dollar in here arrived because
              you failed at something. {data.account?.manager_name} decides what
              to do with it — nothing is ever bought or sold anywhere, so if you
              like a call you place it yourself.
            </p>

            {/* Headline numbers. Total vs deposited is the whole joke: what the
                manager has managed to do with money your own sloppiness paid
                for. */}
            <section className="mt-6 rounded-2xl border border-border bg-surface p-6">

              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted">Total value</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
                    {money(data.total)}
                  </div>
                </div>
                <div className={`text-lg font-medium tabular-nums ${up ? "text-emerald-500" : "text-red-500"}`}>
                  {pct(data.gainPercent)}
                  <span className="ml-2 text-sm text-muted">{money(data.gain)}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted">
                <span>Contributed by your failures <span className="tabular-nums text-foreground">{money(data.deposited)}</span></span>
                <span>Uninvested <span className="tabular-nums text-foreground">{money(data.cash)}</span></span>
              </div>

              <div className="mt-4">
                <RunFundButton />
              </div>

            </section>

            {data.account?.thesis && (
              <section className="mt-4 rounded-2xl border border-border bg-surface p-6">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                  {data.account.manager_name}&apos;s thesis
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-foreground">
                  {data.account.thesis}
                </p>
              </section>
            )}

            {positions.length > 0 && (

              <section className="mt-4 rounded-2xl border border-border bg-surface p-6">

                <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Holdings
                </h2>

                <div className="mt-2">
                  {positions.map(p => (
                    <div key={p.symbol} className="border-t border-border py-3 first:border-t-0">

                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-medium text-foreground">{p.symbol}</span>
                          <span className="ml-2 text-xs text-muted">{p.name}</span>
                          {p.stale && (
                            <span className="ml-2 text-xs text-muted">· price unavailable</span>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="tabular-nums text-foreground">{money(p.value)}</div>
                          <div className={`text-xs tabular-nums ${Number(p.gainPercent) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {pct(p.gainPercent)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-1 text-xs text-muted">
                        {Number(p.shares).toFixed(4)} @ {money(p.avg_cost)} · now {money(p.price)}
                      </div>

                      {p.thesis && (
                        <p className="mt-1 text-xs italic leading-relaxed text-muted">
                          &ldquo;{p.thesis}&rdquo;
                        </p>
                      )}

                    </div>
                  ))}
                </div>

              </section>

            )}

            <section className="mt-4">

              <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                Dispatches
              </h2>

              {dispatches.length === 0 ? (

                <p className="mt-3 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
                  Nothing filed yet. It runs each morning, or press Run above.
                </p>

              ) : (

                <div className="mt-3 space-y-3">
                  {dispatches.map(d => (
                    <article key={d.id} className="rounded-2xl border border-border bg-surface p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-medium text-foreground">{d.headline}</h3>
                        <span className="text-xs text-muted">{formatDate(d.created_at)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {d.content}
                      </p>
                      {d.snapshot?.depositedToday > 0 && (
                        <p className="mt-3 border-t border-border pt-2 text-xs text-muted">
                          {money(d.snapshot.depositedToday)} added that day ·
                          fund at {money(d.snapshot.total)}
                        </p>
                      )}
                    </article>
                  ))}
                </div>

              )}

            </section>
          </>

        )}

      </main>
    </div>
  );

}
