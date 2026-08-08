"use client";

import { useEffect, useRef } from "react";
import { stagger, createTimeline, createDrawable, reducedMotion, utils } from "../motion.js";


// The opening sequence.
//
// It assembles a graph out of nothing and then resolves it into the wordmark,
// because that is literally what the product does: scattered records, then the
// connections between them, then something readable. An intro that showed
// anything else would be decoration.
//
// Four rules keep a full-screen animation from being a liability:
//
//   It is hidden in the markup and revealed by script. A visitor with no
//   JavaScript never has a full-screen panel dropped over the page by markup
//   that nothing will ever run to take away again.
//
//   It plays once per session. Stored in sessionStorage rather than
//   localStorage, so it is an arrival rather than a toll gate on every
//   navigation, and it comes back for a genuinely new visit.
//
//   It is skippable and it is honest about it. Click, tap, Escape or Enter ends
//   it immediately, and a visible control says so.
//
//   It never plays under prefers-reduced-motion. A full-viewport motion
//   sequence is the single worst thing to show someone who has asked the
//   operating system for less of it.


const KEY = "pos_intro_played";

const W = 760;
const H = 680;
const CX = W / 2;
const CY = H / 2;


// Three rings, laid out by formula so the composition is identical on every
// visit. A random scatter would put the points somewhere slightly different
// each time, which is the opposite of what an opening title should do.
function buildPoints() {

  const rings = [
    { count: 6, radius: 92, phase: 0 },
    { count: 12, radius: 178, phase: 0.26 },
    { count: 18, radius: 268, phase: 0.52 }
  ];

  const points = [];

  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.count; i++) {
      const angle = (i / ring.count) * Math.PI * 2 + ring.phase;
      // A gentle elliptical squash so it reads as a field rather than a target.
      points.push({
        ring: r,
        x: CX + Math.cos(angle) * ring.radius * 1.28,
        y: CY + Math.sin(angle) * ring.radius * 0.86
      });
    }
  });

  return points;

}


function buildEdges(points) {

  const edges = [];

  // Around each ring.
  let offset = 0;

  for (const count of [6, 12, 18]) {
    for (let i = 0; i < count; i++) {
      edges.push([offset + i, offset + ((i + 1) % count)]);
    }
    offset += count;
  }

  // …and a spoke from every outer point to the nearest point one ring in, so
  // the rings read as one structure instead of three.
  const inner = points.slice(0, 6);
  const middle = points.slice(6, 18);
  const outer = points.slice(18);

  const nearest = (from, list, base) => {
    let best = 0;
    let bestDistance = Infinity;
    list.forEach((candidate, i) => {
      const d = (candidate.x - from.x) ** 2 + (candidate.y - from.y) ** 2;
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    return base + best;
  };

  middle.forEach((p, i) => edges.push([6 + i, nearest(p, inner, 0)]));
  outer.forEach((p, i) => { if (i % 2 === 0) edges.push([18 + i, nearest(p, middle, 6)]); });

  return edges;

}


const POINTS = buildPoints();
const EDGES = buildEdges(POINTS);

const WORDMARK = "PersonalOS";


export default function Intro({ onDone }) {

  const ref = useRef(null);
  const finished = useRef(false);

  // Deliberately no React state.
  //
  // Whether to play depends on sessionStorage and a media query, neither of
  // which exists during the server render, so the honest React shape would be
  // state set from an effect. That is both a lint error and an extra render of
  // a full-screen SVG. Showing and hiding an overlay is a DOM concern rather
  // than application state, so the effect drives the element directly, which is
  // exactly the job effects are for. The markup always renders and starts at
  // `display: none`, so nothing is laid out unless it actually plays.
  useEffect(() => {

    const root = ref.current;

    if (!root) return;

    let seen = false;

    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {
      // Private browsing can throw on access. An intro is not worth an error.
      seen = true;
    }

    if (seen || reducedMotion()) {
      onDone?.();
      return;
    }

    root.style.display = "grid";

    const dots = root.querySelectorAll("[data-idot]");
    const lines = root.querySelectorAll("[data-iline]");
    const letters = root.querySelectorAll("[data-iletter]");
    const seed = root.querySelector("[data-iseed]");
    const skip = root.querySelector("[data-iskip]");

    // The page must not scroll while a fixed overlay owns the viewport.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Every property the sequence touches is reset here rather than assumed, so
    // an effect that runs twice replays cleanly from the top instead of picking
    // up halfway through the previous run's final fade.
    utils.set(root, { opacity: 1 });
    utils.set(dots, { opacity: 0, scale: 0, translateX: 0, translateY: 0 });
    utils.set(letters, { opacity: 0, translateY: 34, scale: 0.92 });
    utils.set(seed, { opacity: 0, scale: 0 });
    utils.set(skip, { opacity: 0 });

    const timeline = createTimeline({ defaults: { ease: "out(3)" } });

    timeline
      // One point, then a ring of light leaving it.
      .add(seed, { opacity: 1, scale: 1, duration: 420, ease: "out(4)" })
      .add(seed, { scale: 16, opacity: 0, duration: 900, ease: "out(2)" }, "+=120")

      // The field arrives, thrown outward from the centre. `from: "first"`
      // makes it read as one expansion rather than points appearing at random.
      .add(dots, {
        opacity: 1,
        scale: 1,
        duration: 760,
        delay: stagger(26, { from: "first" }),
        ease: "out(4)"
      }, "-=760")

      // Then, and only then, the connections. Same order as the real system:
      // it never draws an edge to something that is not there yet.
      .add(createDrawable(lines), {
        draw: ["0 0", "0 1"],
        duration: 620,
        delay: stagger(14),
        ease: "inOut(2)"
      }, "-=420")

      .add(skip, { opacity: 1, duration: 300 }, "-=900")

      // The structure recedes and the name resolves out of it.
      .add(dots, { opacity: 0.16, scale: 0.9, duration: 700 }, "+=260")
      .add(lines, { opacity: 0.12, duration: 700 }, "<<")
      .add(letters, {
        opacity: 1,
        translateY: 0,
        scale: 1,
        duration: 720,
        delay: stagger(42),
        ease: "out(4)"
      }, "-=520")

      .add(root, { opacity: 0, duration: 620, ease: "inOut(2)" }, "+=520");

    // One place that ends the sequence, whether it ran out or was skipped, so
    // the scroll lock and the hero handoff cannot be missed on one of the paths.
    const finish = () => {

      if (finished.current) return;

      finished.current = true;

      // Marked as seen only once it has actually been seen through to the end
      // or deliberately skipped.
      //
      // Writing this at the start instead was a real bug: React re-invokes
      // effects in development, and on the second pass the flag was already
      // set, so the sequence was skipped while the first pass's timeline sat
      // paused behind an overlay that nothing would take down. Someone who
      // navigates away mid-sequence has not seen it either, and now gets it
      // next time rather than losing it to a flag they never earned.
      try { sessionStorage.setItem(KEY, "1"); } catch { /* not worth handling */ }

      timeline.pause();
      document.body.style.overflow = previousOverflow;
      root.style.display = "none";
      onDone?.();

    };

    timeline.onComplete = finish;

    // The sequence is roughly 4s. This is the backstop for it never finishing
    // at all, which is not hypothetical: anime.js stops advancing while the
    // document is hidden, so backgrounding the tab mid-intro leaves the
    // timeline parked forever. Since the hero underneath is CSS-hidden until
    // this hands over, a parked timeline does not just mean a stuck overlay —
    // it means the page behind it never appears either. Whatever happens, the
    // handover runs.
    const failsafe = setTimeout(finish, 8000);

    const onKey = (event) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") finish();
    };

    root.addEventListener("click", finish);
    window.addEventListener("keydown", onKey);

    return () => {
      clearTimeout(failsafe);
      root.removeEventListener("click", finish);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      timeline.pause();
    };

  }, [onDone]);

  return (
    <div
      ref={ref}
      // The hero underneath carries the same words in real markup, so there is
      // nothing here for a screen reader to gain and a live full-screen
      // animation to lose. It is also why nothing inside is focusable.
      aria-hidden="true"
      // Hidden in the markup itself, so a visitor with no JavaScript never has
      // a full-screen panel placed over the page by something that will never
      // run to take it away again.
      style={{ display: "none" }}
      className="fixed inset-0 z-50 cursor-pointer place-items-center overflow-hidden bg-paper"
    >

      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" fill="none" preserveAspectRatio="xMidYMid meet">

        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            data-iline
            x1={POINTS[a].x} y1={POINTS[a].y}
            x2={POINTS[b].x} y2={POINTS[b].y}
            stroke="var(--line)"
            strokeWidth="1"
          />
        ))}

        {POINTS.map((p, i) => (
          <circle
            key={i}
            data-idot
            className="pos-pop"
            cx={p.x} cy={p.y}
            r={p.ring === 0 ? 5 : p.ring === 1 ? 3.6 : 2.6}
            fill={p.ring === 0 ? "var(--moss)" : "var(--ink-soft)"}
          />
        ))}

        <circle data-iseed className="pos-pop" cx={CX} cy={CY} r="7" fill="var(--moss)" />

      </svg>

      <h1 className="pos-display pointer-events-none absolute text-[2.7rem] text-ink sm:text-[4.5rem]">
        {WORDMARK.split("").map((letter, i) => (
          <span key={i} data-iletter className="inline-block">{letter}</span>
        ))}
      </h1>

      <span
        data-iskip
        className="pos-data absolute bottom-10 text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft"
      >
        Tap to skip
      </span>

    </div>
  );

}
