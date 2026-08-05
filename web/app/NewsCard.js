"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDebateAction } from "./actions.js";


export default function NewsCard({ item }) {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);

  const pick = (side) => {

    setError(null);

    startTransition(async () => {

      const result = await startDebateAction(item.id, side);

      if (result?.success && result.session_id) {
        router.push(`/practice/${result.session_id}`);
      } else {
        setError(result?.error || "Couldn't start that session.");
      }

    });

  };

  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">

      <h3 className="font-medium text-foreground">{item.headline}</h3>
      <p className="mt-1 text-xs text-muted">{item.source}</p>

      <p className="mt-2 text-sm text-foreground leading-relaxed">{item.summary}</p>

      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 text-xs text-accent"
      >
        {expanded ? "Hide the tension" : "What's the actual disagreement?"}
      </button>

      {expanded && (
        <p className="mt-2 text-sm text-muted leading-relaxed">{item.tension}</p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">

        <button
          onClick={() => pick("side_a")}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground hover:border-accent disabled:opacity-50"
        >
          <span className="block text-xs font-medium uppercase tracking-wide text-muted">You argue</span>
          {item.side_a}
        </button>

        <button
          onClick={() => pick("side_b")}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground hover:border-accent disabled:opacity-50"
        >
          <span className="block text-xs font-medium uppercase tracking-wide text-muted">You argue</span>
          {item.side_b}
        </button>

      </div>

      {isPending && <p className="mt-2 text-xs text-muted">Starting…</p>}
      {error && <p className="mt-2 text-xs text-foreground">{error}</p>}

    </div>
  );

}
