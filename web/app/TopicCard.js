"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDebateAction, retireTopicAction } from "./actions.js";


// One evergreen debate topic, ready to argue.
//
// The important difference from the old news-driven card: the two sides are
// shown in full BEFORE the choice, and the background is one tap away. A news
// story needed reading first to know what you thought; a standing question
// like "should billionaires exist" you already have a view on — so the card's
// job is to let you pick a side fast, including the side you don't hold, which
// is the more useful practice.

const CATEGORY_LABELS = {
  ethics: "Ethics",
  economics: "Economics",
  politics: "Politics",
  religion: "Religion",
  technology: "Technology",
  society: "Society"
};


export default function TopicCard({ topic }) {

  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const [retired, setRetired] = useState(false);

  const pick = (side) => {

    setError(null);

    startTransition(async () => {

      const result = await startDebateAction({ debate_topic_id: topic.id, user_side: side });

      if (result?.success && result.session_id) {
        router.push(`/practice/${result.session_id}`);
      } else {
        setError(result?.error || "Couldn't start that session.");
      }

    });

  };

  const retire = () => {

    setError(null);

    startTransition(async () => {

      const result = await retireTopicAction(topic.id);

      if (result?.success) {
        setRetired(true);
      } else {
        setError(result?.error || "Couldn't remove that.");
      }

    });

  };

  if (retired) return null;

  return (
    <div className="rounded-card bg-card p-5 shadow-lift">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">
          <h3 className="font-medium text-ink">{topic.title}</h3>
          <p className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
            {CATEGORY_LABELS[topic.category] || topic.category}
            {topic.used_count > 0 && ` · argued ${topic.used_count}×`}
          </p>
        </div>

        <button
          onClick={retire}
          disabled={isPending}
          aria-label="Remove this topic"
          title="Hide this topic — your past sessions on it are kept"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ember hover:text-ember disabled:opacity-45"
        >
          {isPending ? "…" : "Remove"}
        </button>

      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink">{topic.tension}</p>

      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 text-[0.75rem] font-medium text-ink underline decoration-[var(--line)] decoration-1 underline-offset-[3px] hover:decoration-[var(--ink)]"
      >
        {expanded ? "Hide background" : "Background first"}
      </button>

      {expanded && (
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{topic.context}</p>
      )}

      <p className="mt-4 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
        Pick the side you&apos;ll argue
      </p>

      {/* max-lg: at lg+ the desktop frame holds the app at phone width, so the
          two-column upgrade has to switch back off — see MoneyCharts.js. */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:max-lg:grid-cols-2">

        <button
          onClick={() => pick("side_a")}
          disabled={isPending}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm leading-relaxed text-ink hover:border-ink disabled:opacity-50"
        >
          {topic.side_a}
        </button>

        <button
          onClick={() => pick("side_b")}
          disabled={isPending}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm leading-relaxed text-ink hover:border-ink disabled:opacity-50"
        >
          {topic.side_b}
        </button>

      </div>

      {isPending && <p className="mt-2 text-xs text-ink-soft">Working…</p>}
      {error && <p className="mt-2 text-xs text-ink">{error}</p>}

    </div>
  );

}
