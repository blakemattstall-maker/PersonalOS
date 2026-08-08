"use client";

import { useEffect, useRef } from "react";
import { animate, reducedMotion } from "../motion.js";


// The net under the headline, turning.
//
// What was here before was flat: twelve hand-placed points and eighteen lines in
// 2D. It also did not work. The dots faded in, but the lines never did — the
// timeline animated their `draw` (stroke-dasharray) and never touched opacity,
// and they carry `.pos-scene-hidden`, which is `opacity: 0`. So the connections
// in a picture whose entire subject is connections were invisible, and what you
// saw was a scatter of unrelated dots.
//
// This is a real rotating structure instead. Positions are 3D and projected
// through a perspective camera every frame, so depth is carried by the things
// that actually convey it — perspective, size and opacity — rather than by a
// drop shadow. It rotates slowly enough to be ambient rather than distracting:
// one revolution takes 54 seconds.
//
// It is aria-hidden and decorative on purpose. Section 02 makes the same point
// interactively, with real labels; this only has to say "there is a structure
// here" before you have read the word "connections".


// Points on a sphere via the Fibonacci lattice — even spacing without the
// clumping a random scatter gives, and without hand-placing anything.
//
// Computed once at module scope rather than per render, and the projection
// rounds before it reaches an attribute: Math.cos/Math.sin are not required to
// be correctly rounded, so Node and the browser disagree in the last bits and
// every coordinate would hydrate as a mismatch. Trap #12d, which this file would
// otherwise reintroduce in bulk.
const COUNT = 24;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const NODES = Array.from({ length: COUNT }, (_, i) => {
  const y = 1 - (i / (COUNT - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
});


// Each node linked to its nearest neighbours, deduplicated. Nearest-N rather
// than a distance threshold because it guarantees every node is attached to
// something — a lone floating dot in a picture about relationships is the one
// thing this must never render.
//
// Four, not two. At two, every node has one or two edges and the Fibonacci
// lattice's spiral ordering turns that into a single long chain that reads as a
// wobbly polygon outline, not a net. Four is where triangles start closing and
// the thing looks woven.
const NEIGHBOURS = 4;

const EDGES = (() => {

  const pairs = new Set();

  NODES.forEach((node, i) => {

    const nearest = NODES
      .map((other, j) => ({ j, d: (other.x - node.x) ** 2 + (other.y - node.y) ** 2 + (other.z - node.z) ** 2 }))
      .filter(candidate => candidate.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBOURS);

    for (const { j } of nearest) pairs.add(i < j ? `${i}-${j}` : `${j}-${i}`);

  });

  return [...pairs].map(key => key.split("-").map(Number));

})();


// A handful of nodes carry moss, the colour this app uses for "settled, on
// record". The rest are the same soft ink as body copy. Fixed indices rather
// than "whichever are nearest the camera", so the colour is a property of the
// structure and not a lighting effect that crawls around as it turns.
const ACCENTS = new Set([0, 5, 11, 17, 23]);


const SIZE = { w: 340, h: 236 };
const CENTRE = { x: SIZE.w / 2, y: SIZE.h / 2 };
const RADIUS = 96;

// Camera distance in the same units as the unit sphere. 3.4 is shallow enough
// for the near side to read as clearly nearer, and far enough that the sphere
// does not distort into a fisheye at the edges.
const CAMERA = 3.4;

const round = (n) => Number(n.toFixed(3));


// Edges graded by the average depth of their endpoints, which is what stops the
// back of the net reading as a flat mesh laid over the front of it.
//
// The floor is 0.22 and not lower, and the curve is linear rather than squared,
// because the first attempt at this was the original bug wearing a new hat: at
// `0.06 + 0.5 * depth²` most edges landed between 0.1 and 0.3 on `--line`, which
// against the dark ground is very nearly nothing. It rendered as scattered dots
// with a couple of visible connections — the exact thing being fixed. A diagram
// whose entire subject is the edges has to show the edges.
const edgeOpacity = (a, b) => round(0.22 + 0.5 * ((a + b) / 2));


// One frame. Returns screen position, plus the 0..1 depth everything else is
// derived from: 0 is the far pole, 1 the near one.
function project(node, angle) {

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Yaw only. A second axis looks like tumbling rather than turning, and the
  // Fibonacci lattice already reads as three-dimensional from any yaw.
  const x = node.x * cos - node.z * sin;
  const z = node.x * sin + node.z * cos;

  const scale = CAMERA / (CAMERA - z);

  return {
    x: round(CENTRE.x + x * RADIUS * scale),
    y: round(CENTRE.y + node.y * RADIUS * scale),
    depth: round((z + 1) / 2),
    scale: round(scale)
  };

}


export default function HeroNet() {

  const ref = useRef(null);

  useEffect(() => {

    const root = ref.current;

    if (!root) return;

    const dots = [...root.querySelectorAll("[data-net-dot]")];
    const lines = [...root.querySelectorAll("[data-net-line]")];

    // The initial render is already a complete, correct frame at angle 0, so
    // reduced motion needs no settled state applied — it just never moves.
    if (reducedMotion()) return;

    const paint = (angle) => {

      const points = NODES.map(node => project(node, angle));

      dots.forEach((dot, i) => {
        const p = points[i];
        dot.setAttribute("cx", p.x);
        dot.setAttribute("cy", p.y);
        dot.setAttribute("r", round(1.7 + 2.2 * p.scale * p.depth));
        dot.setAttribute("opacity", round(0.3 + 0.7 * p.depth));
      });

      lines.forEach((line, i) => {
        const [a, b] = EDGES[i];
        line.setAttribute("x1", points[a].x);
        line.setAttribute("y1", points[a].y);
        line.setAttribute("x2", points[b].x);
        line.setAttribute("y2", points[b].y);
        line.setAttribute("opacity", edgeOpacity(points[a].depth, points[b].depth));
      });

    };

    // Driven through the motion layer rather than a bare requestAnimationFrame,
    // so it is one more thing anime.js is pausing rather than a loop of its own
    // that nothing knows about. `loop` keeps it going; no modulo is needed
    // because cos/sin are periodic.
    //
    // The angle is read back off the object anime is mutating, not out of the
    // callback's argument. Reaching into `self.targets[0]` would be a guess about
    // the shape of anime's instance, and a wrong guess here fails exactly the way
    // the bug this file replaces failed: silently, as a thing that renders once
    // and never moves.
    const state = { angle: 0 };

    const spin = animate(state, {
      angle: Math.PI * 2,
      duration: 54000,
      ease: "linear",
      loop: true,
      onUpdate: () => paint(state.angle)
    });

    // Off-screen it is invisible and still costing a frame every 16ms on a
    // phone. The hero is at the top of a long page, so it leaves the viewport
    // almost immediately and stays gone.
    const observer = new IntersectionObserver(
      (entries) => { entries.some(e => e.isIntersecting) ? spin.play() : spin.pause(); },
      { threshold: 0 }
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      spin.pause();
    };

  }, []);

  // Rendered at angle 0, which is a real frame rather than a placeholder — with
  // no JavaScript, or with reduced motion, this is what stays on screen.
  const initial = NODES.map(node => project(node, 0));

  return (
    <div ref={ref} className="pointer-events-none mx-auto w-full max-w-[46rem] px-5 pb-8">
      <svg
        viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
        className="mt-6 h-auto w-full max-w-[26rem]"
        aria-hidden="true"
        fill="none"
      >
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            data-net-line
            x1={initial[a].x} y1={initial[a].y}
            x2={initial[b].x} y2={initial[b].y}
            stroke="var(--ink-soft)"
            strokeWidth="0.9"
            opacity={edgeOpacity(initial[a].depth, initial[b].depth)}
          />
        ))}

        {initial.map((p, i) => (
          <circle
            key={i}
            data-net-dot
            cx={p.x} cy={p.y}
            r={round(1.7 + 2.2 * p.scale * p.depth)}
            fill={ACCENTS.has(i) ? "var(--moss)" : "var(--ink-soft)"}
            opacity={round(0.3 + 0.7 * p.depth)}
          />
        ))}
      </svg>
    </div>
  );

}
