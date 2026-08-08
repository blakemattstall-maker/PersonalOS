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

  // Reduced motion falls through to the browser's own instant jump rather than
  // being handled here: someone who asked the OS for less movement did not ask
  // for a two-second animated scroll, and `behavior: "smooth"` would give them
  // one regardless of the media query.
  const handleSeeHow = useCallback((event) => {

    const target = document.getElementById("capture");

    if (!target || reducedMotion()) return;

    event.preventDefault();

    target.scrollIntoView({ behavior: "smooth", block: "start" });

    // The hash still belongs in the URL — it is what makes the position
    // shareable and survives a reload. Written rather than navigated to, so the
    // browser does not also jump there and cancel the scroll that is running.
    history.replaceState(null, "", "#capture");

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
          {/* pos-reveal is what keeps these invisible from the very first byte
              of HTML — the same class app/globals.css already hides
              `data-reveal` content behind, with the same reduced-motion and
              no-JS overrides. Without it these render at full opacity for the
              one paint before this effect runs, then the intro overlay's own
              effect covers them, then they animate in on top of that: a
              visible pop-then-vanish-then-animate on every fresh visit. */}
          {["Everything", "you", "said", "you'd", "do,", "already", "sorted."].map((word, i) => (
            <span key={i}>
              <span data-word className="pos-reveal inline-block">{word}</span>
              {i < 6 ? " " : ""}
            </span>
          ))}
        </h1>

        {/* The old version of this opened on the filing mechanism — parsed,
            dated, filed — which is the third thing a reader needs, not the
            first. It described the intake pipe of a system it never named. This
            says what the thing IS, then what becomes possible, and leaves the
            mechanism to the seven sections below that exist to explain it. */}
        <p data-tail className="pos-reveal mt-6 max-w-[35rem] text-[1.05rem] leading-relaxed text-ink-soft">
          PersonalOS is a single system of record for your goals, intentions,
          tasks, notes, spending and the people in your life — and a reasoning
          layer that works across all of it on your behalf.
        </p>

        <p data-tail className="pos-reveal mt-4 max-w-[35rem] text-[1.05rem] leading-relaxed text-ink-soft">
          Say one sentence and it files itself, dated and linked to everything
          related. Ask for a plan and it builds the whole thing — tasks and
          events in Google Calendar and Tasks, drafted email, a working document
          in Docs, research pulled from the open web — then tracks what you
          actually do against it, scores what is slipping, and each morning reads
          the whole picture back in a few sentences. The rest of the day it stays
          quiet unless something genuinely needs you.
        </p>

        <p data-tail className="pos-reveal mt-3 max-w-[34rem] text-[0.9rem] leading-relaxed text-ink-soft">
          This page is a walkthrough of how each part works. Every section opens
          up into the mechanism behind it, so you can read it either way.
        </p>

        <div data-tail className="pos-reveal mt-8 flex flex-wrap items-center gap-3">
          {/* Still a real href, so it works with JavaScript off, opens in a new
              tab, and shows the target on hover. onClick only upgrades the jump
              to a glide. Done here rather than with `scroll-behavior: smooth` in
              globals.css because that property only applies to the scrolling
              element — html — and setting it there would also animate every
              route change's scroll-to-top across the whole app. */}
          <a
            href="#capture"
            onClick={handleSeeHow}
            className="inline-flex items-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-3 text-[0.88rem] font-medium text-paper transition-opacity hover:opacity-90"
          >
            See how it works
            <span aria-hidden="true">↓</span>
          </a>
          <Link
            href="/login"
            className="inline-flex items-center rounded-[var(--r-pill)] border border-[var(--line)] px-5 py-3 text-[0.88rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Sign in
          </Link>
        </div>

      </div>

      {/* Foreshadows the section on how records are connected, before the
          reader has met the word. aria-hidden because it says nothing a screen
          reader can use — section 02 explains the same idea in words. */}
      <HeroNet />

    </header>
  );

}
