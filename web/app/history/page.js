import Link from "next/link";
import { formatDate, DeepThoughtBody } from "../shared.js";


async function getHistory() {

  const backendUrl = process.env.BACKEND_URL;

  try {

    const res = await fetch(`${backendUrl}/api/history`, {
      cache: "no-store"
    });

    return await res.json();

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
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">History</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Dashboard
          </Link>
        </div>

        {items.length === 0 ? (

          <p className="mt-8 text-muted">Nothing resolved yet.</p>

        ) : (

          <div className="mt-8 space-y-8">
            {items.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="rounded-2xl border border-border bg-surface p-6">

                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">
                    {item.kind === "thought" ? "Deep Thinking" : item.kind === "nudge" ? "Nudge" : "Brief"}
                  </span>
                  <span className="text-xs text-muted">{formatDate(item.created_at)}</span>
                </div>

                {item.kind === "thought" && (
                  <>
                    <h3 className="mt-2 font-medium text-foreground">{item.topic}</h3>
                    <DeepThoughtBody content={item.content} />
                  </>
                )}

                {item.kind === "nudge" && (
                  <>
                    <p className="mt-2 text-foreground leading-relaxed">{item.message}</p>
                    {item.intentions?.content && (
                      <p className="mt-1 text-xs text-muted">Re: {item.intentions.content}</p>
                    )}
                  </>
                )}

                {item.kind === "brief" && (
                  <div className="mt-2 whitespace-pre-wrap text-foreground leading-relaxed">
                    {item.content}
                  </div>
                )}

              </div>
            ))}
          </div>

        )}

      </main>
    </div>
  );

}
