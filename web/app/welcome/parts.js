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


// The eyebrow's colour, per section. The eyebrows are already numbered
// (01 · CAPTURE), so the sections genuinely are a sequence and colour reinforces
// structure that is really there rather than decorating a flat list.
//
// Ember is in this rotation, which it would never be inside the app. /welcome is
// the signed-out tour: there is no session, no queue, nothing waiting on anyone,
// so orange carries no signal here to dilute. See the note in globals.css.
const TONE = {
  ember: "text-ember-ink",
  moss: "text-moss",
  tide: "text-tide",
  iris: "text-iris",
  ink: "text-ink-soft"
};


// `split` turns a section into a two-column feature row on desktop only —
// the plain-language copy in one column, the animated scene beside it, and
// `flip` swaps which side each takes so the rows alternate down the page. It is
// strictly a wide-screen affordance: every class it adds is `lg:`-gated, so on a
// phone the copy and scene stack exactly as they always have.
//
// `wide` opts a single-column section into the same 64rem frame without the
// grid — for the detector cards, which fill that width on their own. Every
// section from the hero through the detectors shares this one frame so the page
// keeps a single, unbroken left/right margin down the whole tour rather than
// stepping in and out. The technical coda and the footer are deliberately
// narrower, a settling-down before the end.
export function Section({ id, eyebrow, title, lede, children, tech, tone = "ink", techLabel = "Under the hood", split = false, flip = false, wide = false }) {

  const ref = useRef(null);

  useEffect(() => revealChildren(ref.current, { gap: 90 }), []);

  // Top padding only, and that is the fix rather than a smaller number.
  // `py-24` put 96px below every section AND 96px above the next one, so the gap
  // at each seam was 192px — the "Under the hood" box, which is the last thing in
  // most sections, sat in a third of a screen of nothing. Spacing between two
  // things belongs to one of them; here it is the one below, so the gap is
  // whatever `pt` says and cannot double. welcome/page.js's footer carries the
  // matching `pt` for the last seam.
  //
  // A split section is allowed to grow wider than the reading column so the two
  // columns each keep a comfortable measure; a single-column one stays at 46rem
  // because that IS the comfortable measure for one column of prose.
  return (
    <section
      id={id}
      ref={ref}
      className={`mx-auto w-full max-w-[46rem] scroll-mt-20 px-5 pt-16 sm:pt-24 ${split || wide ? "lg:max-w-[64rem]" : ""}`}
    >

      {/* No display set at the base width, so on a phone this is an ordinary
          block and the two children stack in source order — identical to before
          this wrapper existed. The grid only switches on at lg. */}
      <div className={split ? "lg:grid lg:grid-cols-2 lg:items-center lg:gap-x-14" : ""}>

        <div className="pos-reveal" data-reveal>
          <p className={`pos-data text-[0.7rem] uppercase tracking-[0.14em] ${TONE[tone] || TONE.ink}`}>
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

        {/* mt-8 keeps the stacked gap on a phone; lg:mt-0 drops it once the scene
            sits alongside the copy. order-first (lg only) is what alternates the
            rows — on a phone the copy always comes first regardless of `flip`. */}
        <div
          className={`pos-reveal mt-8 ${split ? "lg:mt-0" : ""} ${split && flip ? "lg:order-first" : ""}`}
          data-reveal
        >
          {children}
        </div>

      </div>

      {/* The bar spans the full frame, wide or narrow — a box stopped at
          three-quarter width under a two-column row read as a mistake, not a
          measure. Readability is handled inside Detail, which caps the open
          prose while letting the bar itself run edge to edge. */}
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

      {/* The box may span the whole 64rem frame, so the prose inside carries
          its own measure — dense technical copy at 120 characters a line is
          where reading goes to die. The border-t spans the full box; only the
          text is capped. */}
      <div className="mt-3.5 border-t border-[var(--line)] pt-3.5">
        <div className="max-w-[46rem] space-y-3 text-[0.85rem] leading-relaxed text-ink-soft">
          {children}
        </div>
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
