import Link from "next/link";
import { backendGet } from "../backend.js";
import NewsCard from "../NewsCard.js";
import PitchRecorder from "../PitchRecorder.js";
import RefreshDigestButton from "../RefreshDigestButton.js";
import { formatDate } from "../shared.js";


export const dynamic = "force-dynamic";
export const maxDuration = 60;


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


function SessionRow({ session }) {

  const label = session.type === "debate"
    ? session.news_items?.headline || "Debate"
    : (session.topic || "Pitch");

  const status = session.status === "completed"
    ? (session.type === "debate" ? "Graded" : "Reviewed")
    : "In progress";

  return (
    <Link
      href={`/practice/${session.id}`}
      className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0 text-sm hover:text-accent"
    >
      <span className="min-w-0 truncate">
        <span className="text-xs uppercase tracking-wide text-muted mr-2">{session.type}</span>
        {label}
      </span>
      <span className="shrink-0 text-xs text-muted">{status} · {formatDate(session.created_at)}</span>
    </Link>
  );

}


export default async function Practice() {

  const [digestData, sessionsData] = await Promise.all([
    safeGet("/api/practice", { success: false, digest: [] }),
    safeGet("/api/practice?sessions=1", { success: false, sessions: [] })
  ]);

  const digest = digestData.digest || [];
  const sessions = sessionsData.sessions || [];

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Practice</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Back
          </Link>
        </div>

        <p className="mt-2 text-sm text-muted">
          Argue a real, current story with the app taking the other side —
          or record a pitch and get it graded.
        </p>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-6">

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Debate — today&apos;s stories
            </h2>
            <RefreshDigestButton />
          </div>

          {digest.length === 0 ? (

            <p className="mt-4 text-sm text-muted">
              Nothing framed yet today — the digest pulls fresh each morning.
              Real news, not invented: it needs live feeds to have run at
              least once.
            </p>

          ) : (

            <div className="mt-4 space-y-6">
              {digest.map(item => <NewsCard key={item.id} item={item} />)}
            </div>

          )}

        </section>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Pitch — record and get graded
          </h2>
          <PitchRecorder />
        </section>

        {sessions.length > 0 && (

          <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Recent sessions
            </h2>
            <div className="mt-2">
              {sessions.map(s => <SessionRow key={s.id} session={s} />)}
            </div>
          </section>

        )}

      </main>
    </div>
  );

}
