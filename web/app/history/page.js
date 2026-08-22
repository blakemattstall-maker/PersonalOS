import { formatDate, DeepThoughtBody } from "../shared.js";
import { backendGet } from "../backend.js";
import Reveal from "../Reveal.js";
import { Page, PageHeader, ItemCard, Body, Empty } from "../ui.js";


// Every page here reads live state, so none of them may be prerendered.
//
// This was previously implicit: backendGet used fetch(..., { cache: "no-store" }),
// and that opted the route out of static generation as a side effect. Now that
// the same call is a direct in-process function call there is no fetch for Next
// to notice, so without this the page is prerendered at build time and serves
// build-time data until the next deploy. The build output is where this shows
// up — a page marked (Static) that should be (Dynamic).
export const dynamic = "force-dynamic";


async function getHistory() {

  try {

    return await backendGet("/api/history");

  } catch (error) {

    return { thoughts: [], nudges: [], briefs: [] };

  }

}


export default async function History() {

  const { thoughts = [], nudges = [], briefs = [] } = await getHistory();

  const items = [
    ...thoughts.map(t => ({ ...t, kind: "thought" })),
    ...nudges.map(n => ({ ...n, kind: "nudge" })),
    ...briefs.map(b => ({ ...b, kind: "brief" }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <Page>

      <Reveal gap={70}>

      <div className="pos-reveal" data-reveal>
        <PageHeader title="Earlier">
          Briefs you&apos;ve already read and everything you&apos;ve cleared,
          newest first.
        </PageHeader>
      </div>

      {items.length === 0 ? (

        <div className="pos-reveal" data-reveal>
          <Empty>
            Nothing here yet. Anything you resolve on Today lands here, along
            with every morning brief.
          </Empty>
        </div>

      ) : (

        <div className="space-y-3">
          {items.map((item) => (

            <div key={`${item.kind}-${item.id}`} className="pos-reveal" data-reveal>

            {/* waiting={false} throughout — the whole page is things already
                dealt with, and the ember dot means the opposite of that. */}
            <ItemCard
              kind={item.kind}
              waiting={false}
              title={item.kind === "thought" ? item.topic : undefined}
              meta={formatDate(item.created_at)}
            >

              {item.kind === "thought" && <DeepThoughtBody content={item.content} />}

              {item.kind === "nudge" && (
                <>
                  <Body text={item.message} className="mt-3" />
                  {item.intentions?.content && (
                    <p className="mt-2 text-[0.82rem] text-ink-soft">
                      Because you said: {item.intentions.content}
                    </p>
                  )}
                </>
              )}

              {item.kind === "brief" && (
                <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed text-ink">
                  {item.content}
                </div>
              )}

            </ItemCard>

            </div>

          ))}
        </div>

      )}

      </Reveal>

    </Page>
  );

}
