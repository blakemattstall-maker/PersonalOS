import Link from "next/link";
import { backendGet } from "../../backend.js";
import DebateSession from "../../DebateSession.js";
import FeedbackCard from "../../FeedbackCard.js";
import ReadAloud from "../../ReadAloud.js";
import { Page, PageHeader, Card, Empty } from "../../ui.js";


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

  // A debate session points at either an evergreen topic (everything since the
  // split) or a news story (sessions recorded before it). Both carry the same
  // four fields the page needs, so resolve once here rather than branching in
  // the markup — old sessions must keep opening.
  const subject = session?.debate_topics
    ? {
        title: session.debate_topics.title,
        tension: session.debate_topics.tension,
        side_a: session.debate_topics.side_a,
        side_b: session.debate_topics.side_b
      }
    : session?.news_items
      ? {
          title: session.news_items.headline,
          tension: session.news_items.tension,
          side_a: session.news_items.side_a,
          side_b: session.news_items.side_b
        }
      : null;

  const title = session?.type === "pitch"
    ? (session.mode === "explainer" ? "Explainer" : "Pitch")
    : "Debate";

  return (
    <Page>

      {/* The one place a back link still earns its keep: this is a detail view
          under /practice, and the tab bar can only return you to the list's
          root. Everywhere else the tab bar replaced it. */}
      <Link
        href="/practice"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-soft hover:text-ink"
      >
        <span aria-hidden="true">‹</span> All practice
      </Link>

      <PageHeader title={title} />

      {!session ? (

        <Empty>
          Couldn&apos;t find that session. It may have been removed — the list
          on Practice shows everything still saved.
        </Empty>

      ) : session.type === "debate" ? (

        <>
          <Card>
            <h2 className="pos-display text-[1.15rem] text-ink">{subject?.title}</h2>
            <p className="mt-2 text-[0.87rem] leading-relaxed text-ink-soft">{subject?.tension}</p>
            <div className="mt-3 rounded-item bg-[var(--sunken)] px-4 py-3">
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                You&apos;re arguing
              </div>
              <p className="mt-1 text-[0.9rem] leading-snug text-ink">
                {session.user_side === "side_a" ? subject?.side_a : subject?.side_b}
              </p>
            </div>
          </Card>

          <DebateSession session={session} />
        </>

      ) : (

        <Card>

          {session.topic && (
            <p className="text-[0.85rem] text-ink-soft">Topic: {session.topic}</p>
          )}

          {/* The brief he was working from, when this was a generated
              explainer — the feedback below is unreadable without it. */}
          {session.prompt && (
            <p className="mt-2 rounded-item bg-[var(--sunken)] p-4 text-[0.87rem] leading-relaxed text-ink">
              {session.prompt}
            </p>
          )}

          <div className="mt-4 flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-[0.87rem] leading-relaxed text-ink">
              {session.transcript?.[0]?.message}
            </p>
            <ReadAloud text={session.transcript?.[0]?.message || ""} title="Pitch transcript" />
          </div>

          {session.feedback && <FeedbackCard type="pitch" feedback={session.feedback} />}

        </Card>

      )}

    </Page>
  );

}
