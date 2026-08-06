import Link from "next/link";
import { backendGet } from "../backend.js";
import TopicCard from "../TopicCard.js";
import PitchRecorder from "../PitchRecorder.js";
import LoadTopicsButton from "../LoadTopicsButton.js";
import { formatDate } from "../shared.js";
import { Page, PageHeader, Card, SectionTitle, Empty, Meta, link } from "../ui.js";


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
    ? "Debate"
    : (session.mode === "explainer" ? "Explainer" : "Pitch");

  const status = session.status === "completed"
    ? (session.type === "debate" ? "Graded" : "Reviewed")
    : "In progress";

  return (
    <Link
      href={`/practice/${session.id}`}
      className="flex items-center gap-3 border-t border-[var(--line)] py-3 first:border-t-0 first:pt-0"
    >
      <span className="inline-flex shrink-0 items-center rounded-[var(--r-pill)] bg-[var(--sunken)] px-2.5 py-1 text-[0.68rem] font-medium text-ink-soft">
        {kind}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.87rem] text-ink">{label}</span>
      <Meta className="shrink-0">{status}</Meta>
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
    <Page>

      <PageHeader title="Practice">
        Argue a real question with the app taking the other side, or record an
        explainer and find out whether you actually understood something.
      </PageHeader>

      <section className="mb-6">

        <SectionTitle count={topics.length} action={<LoadTopicsButton />}>
          Debate
        </SectionTitle>

        {topics.length === 0 ? (

          // The old copy here named a .sql file and told him to paste it into
          // Supabase. That's a note to whoever maintains this, not something
          // the person using the app can act on — and Diagnostics is where it
          // gets said properly.
          <Empty>
            No questions loaded yet. Load topics to frame the first batch —
            standing questions like whether billionaires should exist, not
            today&apos;s news, so you can argue any of them cold. If they
            don&apos;t appear,{" "}
            <Link href="/settings" className={link()}>Settings</Link>{" "}
            will say what&apos;s wrong.
          </Empty>

        ) : (

          <div className="space-y-3">
            {topics.map(topic => <TopicCard key={topic.id} topic={topic} />)}
          </div>

        )}

      </section>

      <Card className="mb-6">
        <SectionTitle>Pitch or explain</SectionTitle>
        <p className="-mt-1 mb-3 text-[0.85rem] leading-relaxed text-ink-soft">
          Record without notes. Graded on whether it landed, not on how it sounded.
        </p>
        <PitchRecorder />
      </Card>

      {sessions.length > 0 && (
        <Card>
          <SectionTitle count={sessions.length}>Recent sessions</SectionTitle>
          <div>
            {sessions.map(s => <SessionRow key={s.id} session={s} />)}
          </div>
        </Card>
      )}

    </Page>
  );

}
