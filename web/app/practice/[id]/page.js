import Link from "next/link";
import { backendGet } from "../../backend.js";
import DebateSession from "../../DebateSession.js";
import FeedbackCard from "../../FeedbackCard.js";
import ReadAloud from "../../ReadAloud.js";


export const dynamic = "force-dynamic";
export const maxDuration = 60;


export default async function PracticeSession({ params }) {

  const { id } = await params;

  let data;

  try {
    data = await backendGet(`/api/practice?session=${id}`);
  } catch (error) {
    data = { success: false };
  }

  const session = data?.session;

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">
            {session?.type === "pitch" ? "Pitch" : "Debate"}
          </h1>
          <Link href="/practice" className="text-sm text-muted hover:text-accent">
            ← Practice
          </Link>
        </div>

        {!session ? (

          <p className="mt-8 text-sm text-muted">Couldn&apos;t find that session.</p>

        ) : session.type === "debate" ? (

          <>
            <div className="mt-4 rounded-2xl border border-border bg-surface p-6">
              <h2 className="font-medium text-foreground">{session.news_items?.headline}</h2>
              <p className="mt-2 text-sm text-muted">{session.news_items?.tension}</p>
              <p className="mt-2 text-xs text-muted">
                You&apos;re arguing: <span className="text-foreground">
                  {session.user_side === "side_a" ? session.news_items?.side_a : session.news_items?.side_b}
                </span>
              </p>
            </div>

            <DebateSession session={session} />
          </>

        ) : (

          <div className="mt-4 rounded-2xl border border-border bg-surface p-6">

            {session.topic && <p className="text-sm text-muted">Topic: {session.topic}</p>}

            <div className="mt-3 flex items-start justify-between gap-3">
              <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                {session.transcript?.[0]?.message}
              </p>
              <ReadAloud text={session.transcript?.[0]?.message || ""} title="Pitch transcript" />
            </div>

            {session.feedback && <FeedbackCard type="pitch" feedback={session.feedback} />}

          </div>

        )}

      </main>
    </div>
  );

}
