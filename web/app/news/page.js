import Link from "next/link";
import { backendGet } from "../backend.js";
import NewsCard from "../NewsCard.js";
import RefreshDigestButton from "../RefreshDigestButton.js";


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
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">News</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Back
          </Link>
        </div>

        <p className="mt-2 text-sm text-muted">
          Real stories from live feeds, ordered by what actually matters to you
          — not by what a wire service ran most recently. Each one carries the
          background and however many honest readings it genuinely has.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {present.length > 0
              ? present.map(c => (
                  <span key={c}>{CATEGORY_LABELS[c]} {counts[c]}</span>
                ))
              : null}
          </div>

          <RefreshDigestButton />

        </div>

        {items.length === 0 ? (

          <div className="mt-4 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            <p>
              Nothing in the feed yet. Tap <strong className="text-foreground">Refresh</strong> to
              pull from the live sources now — it runs on its own each morning
              after that.
            </p>
            <p className="mt-2">
              The news itself is always real, fetched from published feeds. It
              is never a model recalling &ldquo;what happened today&rdquo;, which
              would be stale or invented.
            </p>
          </div>

        ) : (

          <div className="mt-4 space-y-4">
            {items.map(item => <NewsCard key={item.id} item={item} />)}
          </div>

        )}

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Want to argue one of these instead of read it?{" "}
          <Link href="/practice" className="text-accent">Practice</Link>{" "}
          has standing questions built for that — no briefing required.
        </p>

      </main>
    </div>
  );

}
