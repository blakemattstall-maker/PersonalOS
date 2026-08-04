import Link from "next/link";
import { formatDate, DeepThoughtBody } from "./shared.js";
import ResolveButton from "./ResolveButton.js";


async function getBrief() {

  const backendUrl = process.env.BACKEND_URL;

  try {

    const res = await fetch(`${backendUrl}/api/brief/latest?peek=true`, {
      cache: "no-store"
    });

    return await res.json();

  } catch (error) {

    return { success: false, hasBrief: false, error: error.message };

  }

}


async function getPendingDeepThoughts() {

  const backendUrl = process.env.BACKEND_URL;

  try {

    const res = await fetch(`${backendUrl}/api/deepThoughts/pending`, {
      cache: "no-store"
    });

    const data = await res.json();

    return data.thoughts || [];

  } catch (error) {

    return [];

  }

}


async function getPendingNudges() {

  const backendUrl = process.env.BACKEND_URL;

  try {

    const res = await fetch(`${backendUrl}/api/nudges/pending`, {
      cache: "no-store"
    });

    const data = await res.json();

    return data.nudges || [];

  } catch (error) {

    return [];

  }

}


function NeedsYouCard({ item }) {

  if (item.kind === "thought") {

    return (
      <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
        <h3 className="font-medium text-foreground">{item.topic}</h3>
        {item.status === "thinking" ? (
          <p className="mt-2 text-muted italic">Still thinking this through…</p>
        ) : (
          <>
            <DeepThoughtBody content={item.content} />
            <ResolveButton type="thought" id={item.id} />
          </>
        )}
      </div>
    );

  }

  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">Nudge</div>
      <p className="mt-1 text-foreground leading-relaxed">{item.message}</p>
      {item.intentions?.content && (
        <p className="mt-1 text-xs text-muted">Re: {item.intentions.content}</p>
      )}
      <ResolveButton type="nudge" id={item.id} />
    </div>
  );

}


export default async function Home() {

  const [brief, pendingThoughts, pendingNudges] = await Promise.all([
    getBrief(),
    getPendingDeepThoughts(),
    getPendingNudges()
  ]);

  const needsYou = [
    ...pendingThoughts.map(t => ({ ...t, kind: "thought" })),
    ...pendingNudges.map(n => ({ ...n, kind: "nudge" }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">PersonalOS</h1>
          <Link href="/history" className="text-sm text-muted hover:text-accent">
            History →
          </Link>
        </div>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-6">

          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Needs You
          </h2>

          {needsYou.length === 0 ? (

            <p className="mt-4 text-muted">
              Nothing waiting on you right now.
            </p>

          ) : (

            <div className="mt-4 space-y-8">
              {needsYou.map((item) => (
                <NeedsYouCard key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>

          )}

        </section>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Today
            </h2>
            {brief.created_at && (
              <span className="text-sm text-muted">{formatDate(brief.created_at)}</span>
            )}
          </div>

          <div className="mt-4 whitespace-pre-wrap text-foreground leading-relaxed">
            {brief.hasBrief
              ? brief.content
              : "Nothing yet today — check back after your morning brief runs."}
          </div>

        </section>

      </main>
    </div>
  );

}
