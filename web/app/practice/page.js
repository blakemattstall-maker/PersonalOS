import Link from "next/link";
import { backendGet } from "../backend.js";
import TopicCard from "../TopicCard.js";
import PitchRecorder from "../PitchRecorder.js";
import LoadTopicsButton from "../LoadTopicsButton.js";
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
    ? session.debate_topics?.title || session.news_items?.headline || "Debate"
    : (session.topic || "Pitch");

  const kind = session.type === "debate"
    ? "debate"
    : (session.mode === "explainer" ? "explainer" : "pitch");

  const status = session.status === "completed"
    ? (session.type === "debate" ? "Graded" : "Reviewed")
    : "In progress";

  return (
    <Link
      href={`/practice/${session.id}`}
      className="flex items-center justify-between gap-3 border-t border-border py-3 text-sm first:border-t-0 hover:text-accent"
    >
      <span className="min-w-0 truncate">
        <span className="mr-2 text-xs uppercase tracking-wide text-muted">{kind}</span>
        {label}
      </span>
      <span className="shrink-0 text-xs text-muted">{status} · {formatDate(session.created_at)}</span>
    </Link>
  );

}


export default async function Practice() {

  const [topicsData, sessionsData] = await Promise.all([
    safeGet("/api/practice", { success: false, topics: [] }),
    safeGet("/api/practice?sessions=1", { success: false, sessions: [] })
  ]);

  const topics = topicsData.topics || [];
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
          Argue a real question with the app taking the other side — or record
          an explainer and find out whether you actually understood something.
        </p>

        <div className="mt-8">

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Debate
            </h2>
            <LoadTopicsButton />
          </div>

          {topics.length === 0 ? (

            <div className="mt-4 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
              <p>
                No topics yet. Tap <strong className="text-foreground">Load topics</strong> above
                to frame the first batch — they&apos;re standing questions
                (abortion, billionaires, free speech, AI), not today&apos;s news,
                so you can argue any of them cold.
              </p>
              <p className="mt-2">
                Still empty after that? The <code className="text-foreground">debate_topics</code> table
                probably doesn&apos;t exist yet — run{" "}
                <code className="text-foreground">docs/schema-practice-split.sql</code> in Supabase.
                Check <Link href="/settings" className="text-accent">Settings → Diagnostics</Link>.
              </p>
            </div>

          ) : (

            <div className="mt-4 space-y-4">
              {topics.map(topic => <TopicCard key={topic.id} topic={topic} />)}
            </div>

          )}

        </div>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Pitch &amp; explainer — record and get graded
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
