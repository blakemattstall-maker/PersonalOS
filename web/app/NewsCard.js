"use client";

import { useState, useTransition } from "react";
import { deleteNewsAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";


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

  // The whole story, not just what happens to be expanded — the point of
  // listening instead of reading is not needing to have tapped "Background"
  // first.
  const spoken = [
    item.headline,
    item.summary,
    item.relevance ? `Why this matters to you: ${item.relevance}` : null,
    item.context ? `How we got here: ${item.context}` : null,
    ...viewpoints.map(v => `${v.label}: ${v.take}`)
  ].filter(Boolean).join(" ");

  return (
    <article className="rounded-card bg-card p-5 shadow-lift">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">

          <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
            {CATEGORY_LABELS[item.category] || item.source}
            {item.category && ` · ${item.source}`}
          </p>

          <h3 className="mt-1 font-medium leading-snug text-ink">
            {item.source_url ? (
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink"
              >
                {item.headline}
              </a>
            ) : item.headline}
          </h3>

        </div>

        <div className="flex shrink-0 items-center gap-2">

          <ReadAloud text={spoken} title={item.headline} />

          <button
            onClick={remove}
            disabled={isPending}
            aria-label="Remove this story"
            title="Remove this story"
            className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ember hover:text-ember disabled:opacity-45"
          >
            {isPending ? "…" : "Remove"}
          </button>

        </div>

      </div>

      {item.summary && (
        <p className="mt-3 text-sm leading-relaxed text-ink">{item.summary}</p>
      )}

      {/* Why it's in HIS feed. Only rendered when the sync found a real link —
          the model is instructed to leave it out rather than invent one. */}
      {item.relevance && (
        <p className="mt-3 border-l-2 border-moss pl-3 text-sm leading-relaxed text-ink-soft">
          {item.relevance}
        </p>
      )}

      {(item.context || viewpoints.length > 0) && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-[0.75rem] font-medium text-ink underline decoration-[var(--line)] decoration-1 underline-offset-[3px] hover:decoration-[var(--ink)]"
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
              <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                How we got here
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.context}</p>
            </div>
          )}

          {viewpoints.length > 0 && (

            <div>

              <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                How it&apos;s being read
              </p>

              <div className="mt-2 space-y-2">
                {viewpoints.map((v, i) => (
                  <div key={i} className="rounded-item bg-[var(--sunken)] p-3">
                    <p className="text-xs font-medium text-ink">{v.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">{v.take}</p>
                  </div>
                ))}
              </div>

            </div>

          )}

          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[0.78rem] font-medium text-ink underline decoration-[var(--line)] decoration-1 underline-offset-[3px] hover:decoration-[var(--ink)]"
            >
              Read the original at {item.source}
              <span aria-hidden="true">↗</span>
            </a>
          )}

        </div>

      )}

      {error && <p className="mt-2 text-xs text-ink">{error}</p>}

    </article>
  );

}
