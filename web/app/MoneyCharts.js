"use client";

import { useEffect, useRef } from "react";
import { animate, stagger, createDrawable, countUp, reducedMotion, utils } from "./motion.js";

// Charts for the money page, hand-drawn in SVG rather than pulled from a
// library — the whole vocabulary needed here is an arc and a rounded bar, and a
// charting dependency would ship far more than that while fighting the design
// tokens the rest of the app is built from.
//
// Colour is the constrained part, and the constraint is deliberate. Ember is
// reserved app-wide for one meaning — something is waiting on the user — so it can
// never be a series colour, which leaves the palette essentially two hues. That
// is fine here, because spending categories are ranked by size: this is a
// magnitude encoding, not an identity one, so a single-hue sequential ramp is
// the correct form rather than a compromise. Identity is carried by direct
// labels and a legend, never by colour alone.
//
// The ramp is stepped from moss toward ink and checked for monotonic lightness
// in OKLab, with every adjacent gap >= 0.06 so neighbouring slices stay
// separable. It stops at seven; anything beyond folds into "other" rather than
// inventing an eighth hue.
export const RAMP = [
  "#2f4a43",
  "#4a6b62",
  "#5d8478",
  "#7ba396",
  "#9dbcb1",
  "#bed4cc",
  "#d8e5e0"
];


const money = (n) => {
  const v = Math.abs(Number(n) || 0);
  return v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${v.toFixed(0)}`;
};


function arc(cx, cy, r, from, to) {

  const p = (angle) => [
    cx + r * Math.cos((angle - 90) * Math.PI / 180),
    cy + r * Math.sin((angle - 90) * Math.PI / 180)
  ];

  const [x1, y1] = p(from);
  const [x2, y2] = p(to);

  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;

}


// A donut rather than a filled pie: the hole carries the total, which is the
// number most worth reading, and an arc of constant thickness is easier to
// compare than a wedge whose area grows with radius.
export function SpendDonut({ categories, total }) {

  const ref = useRef(null);

  // The arcs draw themselves on in order of size, which is the same order the
  // legend is in — so the animation is teaching you how to read the chart
  // rather than decorating it. The total in the hole counts up alongside.
  //
  // Nothing here changes a value. `createDrawable` only manipulates
  // stroke-dasharray, and the count-up interpolates toward the number the
  // server already computed and is written out exactly at the end.
  useEffect(() => {

    const root = ref.current;

    if (!root) return;

    const paths = root.querySelectorAll("[data-arc]");
    const label = root.querySelector("[data-total]");

    const stopCount = countUp(label, total, {
      format: (n) => {
        const v = Math.abs(n);
        return v >= 1000
          ? `$${Math.round(v).toLocaleString("en-US")}`
          : `$${v.toFixed(0)}`;
      }
    });

    if (reducedMotion() || paths.length === 0) return stopCount;

    let animation = null;

    const observer = new IntersectionObserver((entries) => {

      if (!entries.some(e => e.isIntersecting)) return;

      observer.disconnect();

      animation = animate(createDrawable(paths), {
        draw: ["0 0", "0 1"],
        duration: 780,
        delay: stagger(85),
        ease: "inOut(3)"
      });

    }, { threshold: 0.25 });

    observer.observe(root);

    return () => {
      observer.disconnect();
      animation?.pause();
      // Leaving a half-drawn dasharray behind would silently misreport the
      // split, so unmounting restores the arcs to whole.
      utils.set(paths, { "stroke-dasharray": "none", "stroke-dashoffset": 0 });
      stopCount();
    };

  }, [total, categories]);

  const size = 190;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // A 2px surface gap between segments, so adjacent arcs never appear to merge.
  const gapDegrees = 1.6;

  // Built with a plain loop rather than a `.map()` closing over a running
  // total. The accumulator is only correct if the callback runs exactly once
  // per item, in order, during this render — which the React Compiler is right
  // not to assume of a callback. A loop makes the sequencing local and
  // obvious instead of relying on that.
  const segments = [];

  for (let i = 0, cursor = 0; i < categories.length; i++) {

    const category = categories[i];
    const sweep = (category.total / total) * 360;
    const from = cursor;
    const to = cursor + sweep;

    segments.push({
      ...category,
      from,
      to: Math.max(from + 0.5, to - gapDegrees),
      colour: RAMP[Math.min(i, RAMP.length - 1)]
    });

    cursor = to;

  }

  return (
    <div ref={ref} className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">

      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-[190px] w-[190px] shrink-0"
        role="img"
        aria-label={`Spending by category. ${categories.map(c => `${c.name} ${c.share} percent`).join(", ")}.`}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />

        {segments.map(s => (
          <path
            key={s.name}
            data-arc
            d={arc(cx, cy, r, s.from, s.to)}
            fill="none"
            stroke={s.colour}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />
        ))}

        <text x={cx} y={cy - 4} textAnchor="middle" className="pos-data" fontSize="22" fill="var(--ink)" data-total>
          {money(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--ink-soft)">
          spent
        </text>
      </svg>

      {/* Always present, because identity must never be colour-alone. */}
      <ul className="flex w-full flex-col gap-2">
        {segments.map(s => (
          <li key={s.name} className="flex items-baseline gap-2.5">
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: s.colour }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-[0.85rem] capitalize text-ink">{s.name}</span>
            <span className="pos-data shrink-0 text-[0.8rem] text-ink-soft">{s.share}%</span>
            <span className="pos-data w-14 shrink-0 text-right text-[0.85rem] text-ink">{money(s.total)}</span>
          </li>
        ))}
      </ul>

    </div>
  );

}


// Ranked bars, because comparing lengths against a shared baseline is the thing
// a donut is worst at. The two answer different questions and both are worth
// having: the donut says "how is it split", this says "how much bigger is the
// top one".
export function CategoryBars({ categories, max }) {

  const ref = useRef(null);

  // Bars grow from the baseline rather than fading in. Length is the thing
  // being compared here, so growing along that axis is the one animation that
  // carries the same information the chart does.
  //
  // The final width is written into the inline style by React, so it is correct
  // before any of this runs and stays correct if none of it does. The animation
  // scales the bar down first and releases it.
  useEffect(() => {

    const root = ref.current;

    if (!root || reducedMotion()) return;

    const bars = root.querySelectorAll("[data-bar]");

    if (bars.length === 0) return;

    utils.set(bars, { scaleX: 0, transformOrigin: "0% 50%" });

    let animation = null;

    const observer = new IntersectionObserver((entries) => {

      if (!entries.some(e => e.isIntersecting)) return;

      observer.disconnect();

      animation = animate(bars, {
        scaleX: 1,
        duration: 700,
        delay: stagger(70),
        ease: "out(3)"
      });

    }, { threshold: 0.2 });

    observer.observe(root);

    return () => {
      observer.disconnect();
      animation?.pause();
      utils.set(bars, { scaleX: 1 });
    };

  }, [categories]);

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {categories.map((c, i) => (
        <div key={c.name} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.85rem] capitalize text-ink">{c.name}</span>
            <span className="pos-data text-[0.85rem] text-ink">{money(c.total)}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-[var(--r-pill)] bg-[var(--sunken)]">
            <div
              data-bar
              className="h-full rounded-[var(--r-pill)]"
              style={{
                width: `${Math.max(2, (c.total / max) * 100)}%`,
                background: RAMP[Math.min(i, RAMP.length - 1)]
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );

}
