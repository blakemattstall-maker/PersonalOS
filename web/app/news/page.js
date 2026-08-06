import Link from "next/link";
import { backendGet } from "../backend.js";
import NewsCard from "../NewsCard.js";
import RefreshDigestButton from "../RefreshDigestButton.js";
import { Page, PageHeader, Empty, Meta, link } from "../ui.js";


export const dynamic = "force-dynamic";
export const maxDuration = 60;


const CATEGORY_ORDER = ["us", "world", "business", "technology", "science", "politics"];

const CATEGORY_LABELS = {
  us: "US",
  world: "World",
  business: "Business",
  technology: "Tech",
  science: "Science",
  politics: "Politics"
};


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


export default async function News() {

  const data = await safeGet("/api/news", { success: false, items: [] });

  const items = data.items || [];

  // The backend already orders by relevance-to-him then recency. Categories
  // are shown as a summary of the spread rather than as filters — the whole
  // point of the ordering is that the top of the page is what matters, and
  // letting him filter to one beat would put that back the way it was.
  const counts = items.reduce((acc, item) => {
    const key = item.category || "other";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const present = CATEGORY_ORDER.filter(c => counts[c]);

  return (
    <Page>

      <PageHeader title="News">
        Ordered by what matters to you, not by what ran most recently.
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">

        {/* The spread, as readings. Not filters — see the note above. */}
        <div className="flex flex-wrap gap-1.5">
          {present.map(c => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] bg-[var(--sunken)] px-2.5 py-1 text-[0.72rem] text-ink-soft"
            >
              {CATEGORY_LABELS[c]}
              <span className="pos-data text-ink">{counts[c]}</span>
            </span>
          ))}
        </div>

        <RefreshDigestButton />

      </div>

      {items.length === 0 ? (

        <Empty>
          Nothing in the feed yet. Pull from the live sources now with
          Refresh — after that it runs on its own each morning. Stories always
          come from published feeds, never from a model recalling the news.
        </Empty>

      ) : (

        <div className="space-y-3">
          {items.map(item => <NewsCard key={item.id} item={item} />)}
        </div>

      )}

      <p className="mt-8 text-[0.82rem] leading-relaxed text-ink-soft">
        Want to argue one of these instead of read it?{" "}
        <Link href="/practice" className={link()}>Practice</Link>{" "}
        has standing questions built for that — no briefing required.
      </p>

    </Page>
  );

}
