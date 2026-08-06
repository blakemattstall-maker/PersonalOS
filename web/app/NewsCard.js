"use client";

import { useState, useTransition } from "react";
import { deleteNewsAction } from "./actions.js";


// A story in the news feed.
//
// This used to be a debate card — pick a side, start sparring. Debate moved to
// its own evergreen topic deck, which frees this to do the thing it was always
// worse at while doubling as a debate launcher: actually informing you.
//
// So the shape changed. Summary and background are the primary content rather
// than something hidden behind "what's the actual disagreement?", and the
// forced two-sided framing is replaced by however many honest viewpoints the
// story genuinely has — which for a discovery or a disaster is one, or none.

const CATEGORY_LABELS = {
  us: "US",
  world: "World",
  business: "Business",
  technology: "Tech",
  science: "Science",
  politics: "Politics"
};


export default function NewsCard({ item }) {

  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState(null);

  const remove = () => {

    setError(null);

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

  const viewpoints = Array.isArray(item.viewpoints) ? item.viewpoints : [];

  return (
    <article className="rounded-2xl border border-border bg-surface p-6">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">

          <p className="text-xs uppercase tracking-wide text-muted">
            {CATEGORY_LABELS[item.category] || item.source}
            {item.category && ` · ${item.source}`}
          </p>

          <h3 className="mt-1 font-medium leading-snug text-foreground">
            {item.source_url ? (
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent"
              >
                {item.headline}
              </a>
            ) : item.headline}
          </h3>

        </div>

        <button
          onClick={remove}
          disabled={isPending}
          aria-label="Remove this story"
          title="Remove this story"
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
        >
          {isPending ? "…" : "Remove"}
        </button>

      </div>

      {item.summary && (
        <p className="mt-3 text-sm leading-relaxed text-foreground">{item.summary}</p>
      )}

      {/* Why it's in HIS feed. Only rendered when the sync found a real link —
          the model is instructed to leave it out rather than invent one. */}
      {item.relevance && (
        <p className="mt-3 border-l-2 border-accent pl-3 text-sm leading-relaxed text-muted">
          {item.relevance}
        </p>
      )}

      {(item.context || viewpoints.length > 0) && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-xs text-accent"
        >
          {expanded
            ? "Less"
            : viewpoints.length > 0
              ? `Background & ${viewpoints.length} view${viewpoints.length === 1 ? "" : "s"}`
              : "Background"}
        </button>
      )}

      {expanded && (

        <div className="mt-3 space-y-4">

          {item.context && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                How we got here
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{item.context}</p>
            </div>
          )}

          {viewpoints.length > 0 && (

            <div>

              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                How it&apos;s being read
              </p>

              <div className="mt-2 space-y-2">
                {viewpoints.map((v, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium text-foreground">{v.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{v.take}</p>
                  </div>
                ))}
              </div>

            </div>

          )}

        </div>

      )}

      {error && <p className="mt-2 text-xs text-foreground">{error}</p>}

    </article>
  );

}
