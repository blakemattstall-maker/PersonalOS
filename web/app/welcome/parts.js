"use client";

import { useEffect, useRef } from "react";
import { revealChildren } from "../motion.js";


// Shared chrome for the tour.
//
// Two audiences read this page and they want opposite things. Someone
// non-technical wants to know what the feature does for a person; someone
// technical wants to know whether the hard part was actually solved or waved
// at. Writing for the average of those two produces something neither reads.
//
// So every section is plain-language on the surface, with the real mechanism
// folded into a <details> underneath. It's a native disclosure element rather
// than a JavaScript accordion: it is keyboard-operable, findable by in-page
// search even while closed in browsers that support it, and works before
// hydration.


export function Section({ id, eyebrow, title, lede, children, tech, techLabel = "Under the hood" }) {

  const ref = useRef(null);

  useEffect(() => revealChildren(ref.current, { gap: 90 }), []);

  return (
    <section
      id={id}
      ref={ref}
      className="mx-auto w-full max-w-[46rem] scroll-mt-20 px-5 py-16 sm:py-24"
    >

      <div className="pos-reveal" data-reveal>
        <p className="pos-data text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
          {eyebrow}
        </p>
        <h2 className="pos-display mt-2.5 text-[1.9rem] leading-[1.1] text-ink sm:text-[2.4rem]">
          {title}
        </h2>
        {lede && (
          <p className="mt-3.5 max-w-[36rem] text-[1rem] leading-relaxed text-ink-soft">
            {lede}
          </p>
        )}
      </div>

      <div className="pos-reveal mt-8" data-reveal>
        {children}
      </div>

      {tech && (
        <div className="pos-reveal mt-6" data-reveal>
          <Detail summary={techLabel}>{tech}</Detail>
        </div>
      )}

    </section>
  );

}


export function Detail({ summary, children }) {

  return (
    <details className="group rounded-item border border-[var(--line)] bg-[var(--sunken)] px-4 py-3 open:pb-4">

      <summary className="flex cursor-pointer list-none items-center gap-2.5 text-[0.85rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--line)] text-[0.7rem] leading-none text-ink-soft transition-transform duration-200 group-open:rotate-45"
        >
          +
        </span>
        {summary}
      </summary>

      <div className="mt-3.5 space-y-3 border-t border-[var(--line)] pt-3.5 text-[0.85rem] leading-relaxed text-ink-soft">
        {children}
      </div>

    </details>
  );

}


// Identifiers, table names and file paths, set in the data face so they read as
// things you could grep for rather than as emphasis.
export function Mono({ children }) {
  return (
    <code className="pos-data rounded-[5px] bg-card px-1.5 py-0.5 text-[0.8em] text-ink">
      {children}
    </code>
  );
}


// A stage: the neutral surface every animated scene sits on. Fixed minimum
// heights on purpose — a scene whose contents animate in would otherwise grow
// the page under the reader's thumb mid-scroll.
export function Stage({ children, className = "", minH = "min-h-[19rem]" }) {
  return (
    <div className={`rounded-card border border-[var(--line)] bg-card p-5 shadow-lift sm:p-6 ${minH} ${className}`}>
      {children}
    </div>
  );
}


// The prompt that tells a phone user this thing responds to touch. Every
// interactive scene carries one, because on a page that is largely
// self-animating there is nothing to distinguish the parts that aren't.
export function TapHint({ children }) {
  return (
    <p className="mt-3.5 flex items-center gap-2 text-[0.78rem] text-ink-soft">
      <span aria-hidden="true" className="grid h-4 w-4 place-items-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M9 11.5V6a1.8 1.8 0 0 1 3.6 0v5" />
          <path d="M12.6 11V9.2a1.7 1.7 0 0 1 3.4 0V11" />
          <path d="M16 11.2v-.8a1.7 1.7 0 0 1 3.4 0V15a5.5 5.5 0 0 1-5.5 5.5h-1.6a5 5 0 0 1-3.7-1.6l-3-3.4a1.7 1.7 0 0 1 2.5-2.3L9 14.4" />
        </svg>
      </span>
      {children}
    </p>
  );
}
