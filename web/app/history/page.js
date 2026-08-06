import { formatDate, DeepThoughtBody } from "../shared.js";
import { backendGet } from "../backend.js";
import { Page, PageHeader, ItemCard, Empty } from "../ui.js";


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

      <PageHeader title="Earlier">
        Briefs you&apos;ve already read and everything you&apos;ve cleared,
        newest first.
      </PageHeader>

      {items.length === 0 ? (

        <Empty>
          Nothing here yet. Anything you resolve on Today lands here, along
          with every morning brief.
        </Empty>

      ) : (

        <div className="space-y-3">
          {items.map((item) => (

            // waiting={false} throughout — the whole page is things already
            // dealt with, and the ember dot means the opposite of that.
            <ItemCard
              key={`${item.kind}-${item.id}`}
              kind={item.kind}
              waiting={false}
              title={item.kind === "thought" ? item.topic : undefined}
              meta={formatDate(item.created_at)}
            >

              {item.kind === "thought" && <DeepThoughtBody content={item.content} />}

              {item.kind === "nudge" && (
                <>
                  <p className="mt-3 leading-relaxed text-ink">{item.message}</p>
                  {item.intentions?.content && (
                    <p className="mt-2 text-[0.82rem] text-ink-soft">
                      Because you said: {item.intentions.content}
                    </p>
                  )}
                </>
              )}

              {item.kind === "brief" && (
                <div className="mt-3 whitespace-pre-wrap leading-relaxed text-ink">
                  {item.content}
                </div>
              )}

            </ItemCard>

          ))}
        </div>

      )}

    </Page>
  );

}
