"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { stagger, createTimeline, reducedMotion, utils } from "../motion.js";
import Intro from "./Intro.js";
import HeroNet from "./HeroNet.js";


export default function Hero() {

  const ref = useRef(null);

  // The hero holds still until the opening sequence hands over, so its entrance
  // is something you watch rather than something that already happened behind
  // an overlay. When there is no intro, this flips immediately.
  const [ready, setReady] = useState(false);

  const handleIntroDone = useCallback(() => setReady(true), []);

  // Both hero CTAs glide the reader all the way down to the demo + waitlist at
  // the foot of the page. The point is the journey: the smooth scroll passes
  // through every section on the way, so a viewer sees how much is here rather
  // than teleporting past it. Falls back to a native jump with JS off or
  // reduced motion — still lands them at the same place.
  const handleToStart = useCallback((event) => {

    const target = document.getElementById("start");

    if (!target) return;

    // Always drive the scroll ourselves rather than leaning on the native
    // href jump — that no-ops when the URL is already at #start (a second
    // click), which would strand the button doing nothing. Smooth when motion
    // is welcome, an instant jump when it is not.
    event.preventDefault();

    target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });

    history.replaceState(null, "", "#start");

  }, []);

  useEffect(() => {

    const root = ref.current;

    if (!root || !ready) return;

    const words = root.querySelectorAll("[data-word]");
    const tail = root.querySelectorAll("[data-tail]");

    // Everything is legible at rest; motion only decides when it arrives.
    if (reducedMotion()) {
      utils.set([...words, ...tail], { opacity: 1, translateY: 0, scale: 1 });
      return;
    }

    utils.set(words, { opacity: 0, translateY: 24 });
    utils.set(tail, { opacity: 0, translateY: 12 });

    const timeline = createTimeline({ defaults: { ease: "out(3)" } });

    timeline
      .add(words, {
        opacity: 1,
        translateY: 0,
        duration: 760,
        delay: stagger(70)
      })
      .add(tail, {
        opacity: 1,
        translateY: 0,
        duration: 620,
        delay: stagger(80)
      }, "-=380");

    return () => {
      timeline.pause();
      utils.set([...words, ...tail], { opacity: 1, translateY: 0, scale: 1 });
    };

  }, [ready]);

  return (
    <header ref={ref} className="relative overflow-hidden">

      <Intro onDone={handleIntroDone} />

      {/* Sign in lives in the corner, small and out of the way: realistically
          the only person who ever needs it is the owner, and a visitor should
          be pulled toward the demo and the waitlist, not a login. */}
      <Link
        href="/login"
        className="absolute right-4 top-4 z-20 rounded-[var(--r-pill)] px-3 py-1.5 text-[0.82rem] font-medium text-ink-soft transition-colors hover:text-ink sm:right-6 sm:top-6"
      >
        Sign in
      </Link>

      <div className="mx-auto w-full max-w-[46rem] px-5 pt-16 pb-4 sm:pt-24">

        {/* The wordmark IS the hero. Big enough to remember, and it resolves
            straight out of the opening sequence's own "Almanac" so the two read
            as one motion. pos-reveal keeps it invisible from the first byte of
            HTML (reduced-motion and no-JS overrides live in globals.css), or it
            flashes at full opacity for the one paint before the effect runs. */}
        <h1 className="pos-display text-[4rem] leading-[0.9] tracking-[-0.02em] text-ink sm:text-[6.5rem]">
          <span data-word className={`pos-reveal pos-wordmark inline-block${ready ? " is-lit" : ""}`}>Almanac</span>
        </h1>

        <p data-tail className="pos-reveal pos-display mt-5 max-w-[32rem] text-[1.65rem] leading-[1.08] text-ink sm:text-[2.4rem]">
          Turn your phone into an executive assistant.
        </p>

        {/* Half the length it was. A wall of text is the wrong first thing to
            hand a stranger; the sections below carry the detail, so the hero
            only has to say what it is and what it feels like. */}
        <p data-tail className="pos-reveal mt-6 max-w-[35rem] text-[1.05rem] leading-relaxed text-ink-soft">
          One place for your tasks, notes, money and the people in your life —
          with a reasoning layer that works across all of it.
        </p>

        <p data-tail className="pos-reveal mt-4 max-w-[35rem] text-[1.05rem] leading-relaxed text-ink-soft">
          Say a sentence and it files itself, linked to everything related. Ask
          for a plan and it builds the whole thing, then reads the picture back
          each morning — and stays quiet the rest of the day.
        </p>

        {/* The only two things a visitor should do — and both glide to the foot
            of the page rather than acting on the spot, so the walkthrough scrolls
            past on the way down. Real #start hrefs, so with JS off (or reduced
            motion) they still jump straight there; onClick upgrades the jump to
            a glide. */}
        <div data-tail className="pos-reveal mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#start"
            onClick={handleToStart}
            className="inline-flex items-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-3 text-[0.88rem] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Try the demo
            <span aria-hidden="true">↓</span>
          </a>
          <a
            href="#start"
            onClick={handleToStart}
            className="inline-flex items-center gap-2 rounded-[var(--r-pill)] border border-[var(--line)] px-5 py-3 text-[0.88rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Join the waitlist
            <span aria-hidden="true">↓</span>
          </a>
        </div>

      </div>

      {/* Foreshadows the section on how records are connected, before the
          reader has met the word. aria-hidden because it says nothing a screen
          reader can use — section 02 explains the same idea in words. */}
      <HeroNet />

    </header>
  );

}
