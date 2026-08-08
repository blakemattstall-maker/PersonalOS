"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { animate, stagger, createTimeline, createDrawable, reducedMotion, utils } from "../motion.js";


// Twelve fixed points and the edges between them, laid out by hand rather than
// by a force simulation. A simulation would cost a physics loop on first paint
// for a result nobody can tell apart from this, and it would put the points
// somewhere slightly different on every load — which is the opposite of a
// wordmark.
const POINTS = [
  [42, 96], [104, 44], [150, 118], [96, 168], [196, 74], [232, 148],
  [286, 62], [300, 132], [252, 196], [166, 202], [58, 176], [212, 26]
];

const EDGES = [
  [0, 1], [1, 2], [2, 3], [0, 3], [1, 4], [4, 5], [2, 5],
  [4, 11], [5, 7], [6, 7], [7, 8], [8, 9], [9, 3], [3, 10],
  [0, 10], [6, 11], [5, 8], [2, 9]
];


// The opening.
//
// The constellation is not decoration — it is the thing the rest of the page is
// about, stated before it is explained. Points appear one at a time, then the
// edges draw between them, which is exactly the order the real system does it
// in: entities first, links second, and never a link to something that isn't
// there yet.
export default function Hero() {

  const ref = useRef(null);

  useEffect(() => {

    const root = ref.current;

    if (!root) return;

    const words = root.querySelectorAll("[data-word]");
    const dots = root.querySelectorAll("[data-dot]");
    const lines = root.querySelectorAll("[data-line]");
    const tail = root.querySelectorAll("[data-tail]");

    // Everything is legible at rest; motion only decides when it arrives.
    if (reducedMotion()) {
      utils.set([...words, ...dots, ...lines, ...tail], { opacity: 1, translateY: 0, scale: 1 });
      return;
    }

    utils.set(words, { opacity: 0, translateY: 24 });
    utils.set(dots, { opacity: 0, scale: 0 });
    utils.set(tail, { opacity: 0, translateY: 12 });

    const timeline = createTimeline({ defaults: { ease: "out(3)" } });

    timeline
      .add(words, {
        opacity: 1,
        translateY: 0,
        duration: 760,
        delay: stagger(70)
      })
      .add(dots, {
        opacity: 1,
        scale: 1,
        duration: 420,
        delay: stagger(45),
        ease: "out(2)"
      }, "-=420")
      .add(createDrawable(lines), {
        draw: ["0 0", "0 1"],
        duration: 620,
        delay: stagger(38),
        ease: "inOut(2)"
      }, "-=260")
      .add(tail, {
        opacity: 1,
        translateY: 0,
        duration: 620,
        delay: stagger(80)
      }, "-=380");

    return () => {
      timeline.pause();
      utils.set([...words, ...dots, ...lines, ...tail], { opacity: 1, translateY: 0, scale: 1 });
    };

  }, []);

  return (
    <header ref={ref} className="relative overflow-hidden">

      <div className="mx-auto w-full max-w-[46rem] px-5 pt-16 pb-4 sm:pt-24">

        <p className="pos-data text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
          PersonalOS
        </p>

        <h1 className="pos-display mt-4 text-[2.5rem] leading-[1.04] text-ink sm:text-[3.6rem]">
          {/* The words are separate elements so they can be staggered, but the
              space between them is a real space rather than a margin. With a
              margin doing the spacing the headline is a single run-on word to
              a screen reader, to anyone copying it, and to anything reading
              the page for a link preview. */}
          {["It", "reads", "the", "day", "before", "you", "do."].map((word, i) => (
            <span key={i}>
              <span data-word className="inline-block">{word}</span>
              {i < 6 ? " " : ""}
            </span>
          ))}
        </h1>

        <p data-tail className="mt-6 max-w-[34rem] text-[1.05rem] leading-relaxed text-ink-soft">
          One person&apos;s operating system. It captures what he says in passing,
          files it, links it to everything it already knows, and interrupts him
          only when something is genuinely waiting.
        </p>

        <p data-tail className="mt-3 max-w-[34rem] text-[0.9rem] leading-relaxed text-ink-soft">
          You don&apos;t have an account here, and that&apos;s fine — this page is the
          tour. Everything below is the real system, described honestly, with the
          mechanism folded in underneath each part.
        </p>

        <div data-tail className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#capture"
            className="inline-flex items-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-3 text-[0.88rem] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Take the tour
            <span aria-hidden="true">↓</span>
          </a>
          <Link
            href="/login"
            className="inline-flex items-center rounded-[var(--r-pill)] border border-[var(--line)] px-5 py-3 text-[0.88rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            I have a passphrase
          </Link>
        </div>

      </div>

      {/* Sits behind the type at low contrast. It is aria-hidden because it
          says nothing a screen reader can use — the section it foreshadows
          explains the same idea in words. */}
      <div className="pointer-events-none mx-auto w-full max-w-[46rem] px-5 pb-8">
        <svg
          viewBox="0 0 340 230"
          className="mt-6 h-auto w-full max-w-[26rem] opacity-90"
          aria-hidden="true"
          fill="none"
        >
          {EDGES.map(([a, b], i) => (
            <line
              key={i}
              data-line
              x1={POINTS[a][0]} y1={POINTS[a][1]}
              x2={POINTS[b][0]} y2={POINTS[b][1]}
              stroke="var(--line)"
              strokeWidth="1"
            />
          ))}
          {POINTS.map(([x, y], i) => (
            <circle
              key={i}
              data-dot
              className="pos-pop"
              cx={x} cy={y}
              r={i % 4 === 0 ? 4.5 : 3}
              fill={i % 4 === 0 ? "var(--moss)" : "var(--ink-soft)"}
            />
          ))}
        </svg>
      </div>

    </header>
  );

}
