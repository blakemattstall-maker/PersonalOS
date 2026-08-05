"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDebateAction, deleteNewsAction } from "./actions.js";


export default function NewsCard({ item }) {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const [deleted, setDeleted] = useState(false);

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

  const remove = () => {

    setError(null);

    // Immediate, no confirm() — the point is a low-friction way to clear out
    // topics that don't land, and this is a synthesized digest entry, not
    // something irreplaceable. A refresh will find something else to fill
    // the slot.
    startTransition(async () => {

      const result = await deleteNewsAction(item.id);

      if (result?.success) {
        setDeleted(true);
      } else {
        setError(result?.error || "Couldn't remove that.");
      }

    });

  };

  if (deleted) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground">{item.headline}</h3>
          <p className="mt-1 text-xs text-muted">{item.source}</p>
        </div>
        <button
          onClick={remove}
          disabled={isPending}
          aria-label="Remove this topic"
          title="Remove this topic"
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
        >
          {isPending ? "…" : "Remove"}
        </button>
      </div>

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

      {isPending && <p className="mt-2 text-xs text-muted">Working…</p>}
      {error && <p className="mt-2 text-xs text-foreground">{error}</p>}

    </div>
  );

}
