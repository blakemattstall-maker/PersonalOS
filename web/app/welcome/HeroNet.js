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


// What the net is a net OF.
//
// Turning abstractly is decoration. Seven of the twenty-four nodes are named for
// a kind of record this app actually keeps, and the tag fades in as its node
// comes round to the front and out again as it recedes — so over one revolution
// the thing tells you it is made of tasks, people, charges and evenings, rather
// than leaving you to assume it means something.
//
// Fixed indices, not "whichever are nearest": the Fibonacci lattice runs
// pole-to-pole, so every third or so is spread in both latitude and longitude and
// they arrive at the front in turn instead of in a clump.
//
// Ember, because that is what was asked for and because on this page it costs
// nothing — /welcome is signed out, nothing is waiting on anybody, so orange has
// no signal here to dilute. --ember-ink rather than --ember: these are 9px
// letters, and --ember is 2.76:1 on --paper.
const TAGS = {
  2:  "Task",
  5:  "Person",
  8:  "Note",
  11: "Event",
  14: "Charge",
  17: "Intention",
  20: "Place"
};

// A tag is only legible on a node that is genuinely facing you, and two tags
// crossing each other read as neither. Above 0.62 depth roughly three of the
// seven are showing at once.
const TAG_THRESHOLD = 0.62;


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
//
// `spread` is the entrance: at 1 every node sits well outside the sphere along
// its own radius, at 0 it is home. Animating it to 0 is twenty-four separate
// records converging into one structure, which is the sentence this whole graphic
// is trying to be. It multiplies the radius rather than adding a random offset,
// so nodes arrive along the line they will occupy instead of swirling.
function project(node, angle, spread = 0) {

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Yaw only. A second axis looks like tumbling rather than turning, and the
  // Fibonacci lattice already reads as three-dimensional from any yaw.
  const x = node.x * cos - node.z * sin;
  const z = node.x * sin + node.z * cos;

  const reach = 1 + spread * 1.9;

  const scale = CAMERA / (CAMERA - z);

  return {
    x: round(CENTRE.x + x * RADIUS * scale * reach),
    y: round(CENTRE.y + node.y * RADIUS * scale * reach),
    depth: round((z + 1) / 2),
    scale: round(scale)
  };

}


export default function HeroNet() {

  const ref = useRef(null);

  useEffect(() => {

    const root = ref.current;

    if (!root) return;

    const stage = root.querySelector("[data-net-stage]");
    const dots = [...root.querySelectorAll("[data-net-dot]")];
    const lines = [...root.querySelectorAll("[data-net-line]")];
    const tags = [...root.querySelectorAll("[data-net-tag]")];

    // The initial render is already a complete, correct frame at angle 0 and
    // fully converged, so reduced motion needs no settled state applied — the
    // `.pos-scene-hidden` override in globals.css reveals it and it never moves.
    if (reducedMotion()) return;

    const paint = (angle, spread) => {

      const points = NODES.map(node => project(node, angle, spread));

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
        // Edges hold off until the nodes have nearly landed. Drawn during the
        // converge they whip around the frame and the entrance reads as chaos
        // rather than as things finding each other.
        line.setAttribute("opacity", round(edgeOpacity(points[a].depth, points[b].depth) * Math.max(0, 1 - spread * 2.2)));
      });

      tags.forEach(tag => {
        const p = points[Number(tag.dataset.netTag)];
        tag.setAttribute("x", p.x);
        tag.setAttribute("y", round(p.y - 8 - 3 * p.scale));
        // Ramped over the top third of the turn toward the viewer, so a tag
        // arrives and leaves rather than blinking.
        const shown = Math.max(0, (p.depth - TAG_THRESHOLD) / (1 - TAG_THRESHOLD));
        tag.setAttribute("opacity", round(shown * (1 - spread)));
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
    const state = { angle: 0, spread: 1 };

    const spin = animate(state, {
      angle: Math.PI * 2,
      duration: 54000,
      ease: "linear",
      loop: true,
      onUpdate: () => paint(state.angle, state.spread)
    });

    // The converge. A second animation with no onUpdate of its own — it only
    // mutates `state`, and the spin above is already repainting every frame, so
    // this costs no extra work and there is no second render loop to keep in step.
    const converge = animate(state, {
      spread: 0,
      duration: 1600,
      ease: "out(3)"
    });

    // Painted before being revealed, and in that order deliberately.
    //
    // `.pos-scene-hidden` holds the group at opacity 0 from the first byte of
    // HTML, so the settled sphere React rendered is never shown. But revealing it
    // before the first frame exists would put that settled sphere on screen for a
    // frame anyway, and the entrance would read as a glitch — assembled, flung
    // apart, reassembled. So the scattered frame is written synchronously here,
    // and only then does the group become visible.
    paint(0, 1);

    stage.style.opacity = "1";

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
    <div ref={ref} className="pointer-events-none mx-auto w-full max-w-[46rem] px-5 pb-8 lg:mx-0 lg:max-w-none lg:px-0 lg:pb-0">
      <svg
        viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
        className="mt-6 h-auto w-full max-w-[26rem] lg:mt-0 lg:max-w-none"
        aria-hidden="true"
        fill="none"
      >
        {/* One group so the whole thing can be held back for the entrance with a
            single class — the same `.pos-scene-hidden` every other scene on this
            page uses, which globals.css un-hides under reduced motion and
            layout.js's <noscript> un-hides without scripting. */}
        <g data-net-stage className="pos-scene-hidden">

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
              fill={TAGS[i] ? "var(--ember-ink)" : "var(--ink-soft)"}
              opacity={round(0.3 + 0.7 * p.depth)}
            />
          ))}

          {/* A named record's dot is ember and so is its tag, so the label and
              the thing it labels are obviously the same object. Rendered last to
              sit above the mesh. */}
          {Object.entries(TAGS).map(([index, label]) => {
            const p = initial[Number(index)];
            const shown = Math.max(0, (p.depth - TAG_THRESHOLD) / (1 - TAG_THRESHOLD));
            return (
              <text
                key={index}
                data-net-tag={index}
                x={p.x} y={round(p.y - 8 - 3 * p.scale)}
                textAnchor="middle"
                fontSize="9"
                className="pos-data"
                fill="var(--ember-ink)"
                /* A halo in the page colour, painted under the glyphs. These tags
                   travel across a mesh of lines and other nodes' dots, so no
                   static position is clear of everything and a 9px label crossing
                   a stroke is unreadable. paintOrder lays the stroke down first,
                   so it reads as clearance rather than as an outline. */
                stroke="var(--paper)"
                strokeWidth="2.6"
                paintOrder="stroke"
                opacity={round(shown)}
              >
                {label}
              </text>
            );
          })}

        </g>
      </svg>
    </div>
  );

}
