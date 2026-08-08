"use client";

import { useEffect, useRef } from "react";
import { revealChildren, countUp } from "./motion.js";


// Wrap a stack of cards in this and every child marked `data-reveal` rises
// into place as it reaches the viewport.
//
// It deliberately takes a container rather than wrapping each card, because
// the stagger only reads as intentional when one component knows the order of
// the whole group. Per-card wrappers give you n independent animations that
// happen to overlap, which looks like jitter.
//
// Server components can use this: the children stay server-rendered and are
// passed through as a slot.
export default function Reveal({ children, className = "", delay = 0, gap = 60 }) {

  const ref = useRef(null);

  useEffect(() => revealChildren(ref.current, { delay, gap }), [delay, gap]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );

}


// A number that counts up to its real value once on screen.
//
// Props are all serialisable on purpose. The obvious design here is to accept a
// `format` callback, but the pages that need this — money, the dashboard — are
// server components, and a function cannot cross that boundary. So the shape of
// the number is described rather than computed, and the formatting happens on
// the client where the animation lives.
//
// `children` is the already-formatted string the server produced. It is what
// renders before hydration and what stays on screen if JavaScript never runs,
// so this can never be the reason a figure is missing or wrong — the animation
// only ever replaces text with the same text.
export function Counted({ value, prefix = "", suffix = "", decimals = 0, className = "", children }) {

  const ref = useRef(null);

  useEffect(() => {

    const format = (n) => prefix + Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }) + suffix;

    return countUp(ref.current, value, { format });

  }, [value, prefix, suffix, decimals]);

  return <span ref={ref} className={className}>{children}</span>;

}
