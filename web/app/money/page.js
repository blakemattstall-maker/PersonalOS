import { backendGet } from "../backend.js";
import Reveal from "../Reveal.js";
import MoneyView from "../MoneyView.js";
import { Page, PageHeader, Empty } from "../ui.js";


export const dynamic = "force-dynamic";
export const maxDuration = 60;


async function getFinance() {
  try {
    // No range parameter. Every range is computed in this one call and the
    // view switches between them client-side — see the note in the finance
    // handler for why per-range fetching was the slow part.
    return await backendGet("/api/finance");
  } catch (error) {
    return { success: false, error: error.message };
  }
}


export default async function Money() {

  const f = await getFinance();

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

  return (
    <Page>

      <Reveal gap={70}>

        <div className="pos-reveal" data-reveal>
          <PageHeader title="Money">
            Straight from your accounts. Balances are live; spending is
            categorised here because your bank sends no category at all.
          </PageHeader>
        </div>

        <MoneyView data={f} />

      </Reveal>

      <p className="mt-6 text-[0.78rem] text-ink-soft">
        Pulled {f.cached ? "from cache" : "live"} · one bank call per 12 hours, sliced locally.
      </p>

    </Page>
  );

}
