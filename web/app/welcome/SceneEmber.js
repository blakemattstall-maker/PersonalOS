"use client";

import { useEffect, useRef, useState } from "react";
import { animate, stagger, reducedMotion, utils } from "../motion.js";
import { Stage, TapHint } from "./parts.js";


// The one design rule the whole interface is built on, demonstrated rather
// than asserted.
//
// Orange appears in exactly one circumstance anywhere in this app: something is
// waiting on Blake. Not links, not headings, not focus rings, not "primary"
// buttons that merely save a form. When he is caught up there is no orange on
// screen at all, which is the entire point — an assistant whose job is to
// interrupt sparingly should look like one.
//
// The colour transition is a CSS transition on the design tokens rather than an
// anime.js colour tween, and deliberately so: the tokens change value between
// light and dark mode, and a tween would need concrete hex endpoints that are
// only correct in one of them. anime.js does the part it is better at — the
// staggered nudge that draws your eye to each element as it changes.
export default function SceneEmber() {

  const [loud, setLoud] = useState(true);

  const ref = useRef(null);

  useEffect(() => {

    const root = ref.current;

    if (!root || reducedMotion()) return;

    const marks = root.querySelectorAll("[data-accent]");

    const animation = animate(marks, {
      translateY: [-3, 0],
      duration: 420,
      delay: stagger(55),
      ease: "out(3)"
    });

    return () => {
      animation.pause();
      utils.set(marks, { translateY: 0 });
    };

  }, [loud]);

  // Ember carried by the mock in each state. Stated as a number because the
  // difference between "used for emphasis" and "reserved" is a count, not a
  // feeling.
  const emberCount = loud ? 5 : 2;

  const accent = loud ? "text-ember" : "text-ink";

  return (
    <>
      <div className="mb-4 inline-flex rounded-[var(--r-pill)] border border-[var(--line)] p-1">
        {[true, false].map(mode => (
          <button
            key={String(mode)}
            type="button"
            onClick={() => setLoud(mode)}
            aria-pressed={loud === mode}
            className={`rounded-[var(--r-pill)] px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors ${
              loud === mode ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {mode ? "Accent as decoration" : "Accent as a signal"}
          </button>
        ))}
      </div>

      <Stage minH="min-h-[24rem]">

        <div ref={ref} className="mx-auto max-w-[22rem]">

          <div className="rounded-card border border-[var(--line)] bg-[var(--sunken)] p-4">

            <p className="pos-data text-[0.62rem] uppercase tracking-[0.12em] text-ink-soft">
              Today
            </p>

            <h3 className="pos-display mt-2 text-[1.6rem] leading-[1.1] text-ink">
              {/* Always ember. This is the count of things waiting — the one
                  thing the colour is for. */}
              <span data-accent className="text-ember transition-colors duration-500">Two</span>{" "}
              things
              <br />
              need you.
            </h3>

            <div className="mt-4 space-y-2">

              <div className="rounded-item bg-card px-3.5 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.62rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                    Deep thinking
                  </span>
                  {/* Always ember: this item genuinely is waiting. */}
                  <span data-accent className="pos-ember-dot" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-[0.85rem] leading-snug text-ink">
                  Is the reel actually blocked, or are you avoiding it?
                </p>
              </div>

              <div className="rounded-item bg-card px-3.5 py-3">
                <span
                  data-accent
                  className={`text-[0.62rem] font-medium uppercase tracking-[0.08em] transition-colors duration-500 ${loud ? "text-ember" : "text-ink-soft"}`}
                >
                  Brief
                </span>
                <p className="mt-1.5 text-[0.85rem] leading-snug text-ink-soft">
                  Read this morning. Nothing owed.
                </p>
              </div>

              <div className="rounded-item bg-card px-3.5 py-3">
                <p data-accent className={`text-[0.85rem] font-medium transition-colors duration-500 ${accent}`}>
                  Sponsorship deck
                </p>
                <p className="mt-1 text-[0.78rem] text-ink-soft">Running · 3 open steps</p>
              </div>

            </div>

            <button
              type="button"
              data-accent
              tabIndex={-1}
              aria-hidden="true"
              className={`mt-4 w-full rounded-[var(--r-pill)] px-4 py-2.5 text-[0.82rem] font-medium transition-colors duration-500 ${
                loud ? "bg-ember text-white" : "bg-ink text-paper"
              }`}
            >
              Earlier briefs
            </button>

          </div>

          <p className="mt-4 text-center text-[0.82rem] leading-relaxed text-ink-soft">
            Ember on screen:{" "}
            <span className="pos-data text-ink">{emberCount}</span>
            {loud
              ? " — four of them decoration, so the fifth stops registering."
              : " — the headline count and the item it refers to. Nothing else."}
          </p>

        </div>

      </Stage>

      <TapHint>Flip the switch above and watch what the colour stops telling you.</TapHint>
    </>
  );

}
