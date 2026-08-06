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
    <div className="rounded-2xl border border-border bg-surface p-6">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">
          <h3 className="font-medium text-foreground">{topic.title}</h3>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted">
            {CATEGORY_LABELS[topic.category] || topic.category}
            {topic.used_count > 0 && ` · argued ${topic.used_count}×`}
          </p>
        </div>

        <button
          onClick={retire}
          disabled={isPending}
          aria-label="Remove this topic"
          title="Hide this topic — your past sessions on it are kept"
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
        >
          {isPending ? "…" : "Remove"}
        </button>

      </div>

      <p className="mt-3 text-sm leading-relaxed text-foreground">{topic.tension}</p>

      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 text-xs text-accent"
      >
        {expanded ? "Hide background" : "Background first"}
      </button>

      {expanded && (
        <p className="mt-2 text-sm leading-relaxed text-muted">{topic.context}</p>
      )}

      <p className="mt-4 text-xs uppercase tracking-wide text-muted">
        Pick the side you&apos;ll argue
      </p>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">

        <button
          onClick={() => pick("side_a")}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-2 text-left text-sm leading-relaxed text-foreground hover:border-accent disabled:opacity-50"
        >
          {topic.side_a}
        </button>

        <button
          onClick={() => pick("side_b")}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-2 text-left text-sm leading-relaxed text-foreground hover:border-accent disabled:opacity-50"
        >
          {topic.side_b}
        </button>

      </div>

      {isPending && <p className="mt-2 text-xs text-muted">Working…</p>}
      {error && <p className="mt-2 text-xs text-foreground">{error}</p>}

    </div>
  );

}
