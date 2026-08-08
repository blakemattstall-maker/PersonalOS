"use client";

import { useEffect, useRef, useState } from "react";
import { stagger, createTimeline, reducedMotion, utils } from "../motion.js";
import { Stage, TapHint } from "./parts.js";


// A slice of the graph, in three dimensions, built from invented sample records.
//
// Every node comes from a different table: contacts, projects, notes,
// transactions, places, events, intentions, tasks, documents. The point of the
// section is that those are normally kept apart — a contact knows nothing about
// a charge, a charge belongs to no project, an evening belongs to nobody.
//
// It was eight nodes on a flat plane. Eight is enough to show that edges exist
// and too few to show what a graph of a real life looks like, and flat made it
// read as a diagram of a schema rather than a body of knowledge with a middle
// and edges. Fifteen nodes at varying depth reads as what it is: a net you are
// looking into.
//
// The depth is a real perspective projection, not hand-faked sizes. Each record
// has a z, and one function turns (x, y, z) into a screen position, a radius, an
// opacity and a label size — so near and far cannot drift out of agreement the
// way they would if each were tuned separately.
//
// It does not rotate, deliberately. The hero's net spins because nothing there
// is clickable; every node here is a 44px touch target with a label, and a
// target that moves under your thumb is a target you miss. Depth is carried by
// projection and paint order instead, which needs no motion at all.


// z runs -1 (deepest) to 1 (nearest). x and y are in the same units and get the
// same perspective divide, so a far node is not merely smaller — it is closer to
// the vanishing point, which is the cue that actually reads as distance.
//
// `above: true` flips a label to the other side of its node, which is the cheap
// way out of a collision: it moves the text without moving the record, and the
// record's position is what carries the depth.
//
// Fifteen labels on one 360-unit canvas do collide, and eyeballing it does not
// find them — "no overlap" and "readable" are different thresholds, and two
// labels can share a baseline with zero overlap and still read as one run-on
// string, which is what "Dana WhitfieldDinner, Thu 7pm" did on a phone. These
// positions were solved against a checker that models DM Mono's real metrics
// (0.59em advance, measured off the render) and demands 8 units of clear space
// between any two labels, between a label and the frame, and between a label and
// somebody else's dot. Four problems, three records nudged. If you move a record,
// re-run that check rather than trusting the picture at desktop width.
const RECORDS = [
  { id: 0,  label: "Priya Raman",        type: "person",      x: -0.72, y: -0.50, z:  0.55 },
  { id: 1,  label: "Partner deck",       type: "project",     x: -0.06, y: -0.66, z:  0.80 },
  { id: 2,  label: "$146.80 Northline",  type: "transaction", x:  0.68, y: -0.44, z:  0.30 },
  { id: 3,  label: "“Printed the decks”",type: "memory",      x:  0.62, y:  0.34, z:  0.62 },
  { id: 4,  label: "Dinner, Thu 7pm",    type: "event",       x: -0.10, y:  0.16, z:  0.90 },
  { id: 5,  label: "Dana Whitfield",     type: "person",      x: -0.80, y:  0.20, z:  0.44 },
  { id: 6,  label: "Kestrel Coworking",  type: "place",       x: -0.52, y:  0.78, z:  0.18 },
  { id: 7,  label: "Onboarding rewrite", type: "intention",   x:  0.34, y:  0.80, z:  0.06 },
  { id: 8,  label: "Send Priya the deck",type: "task",        x:  0.06, y: -0.24, z: -0.30 },
  { id: 9,  label: "Q3 pricing memo",    type: "document",    x:  0.82, y:  0.02, z: -0.52 },
  { id: 10, label: "Northline Studio",   type: "person",      x:  0.44, y: -0.78, z: -0.34 },
  { id: 11, label: "Ship by 14 Nov",     type: "intention",   x: -0.55, y: -0.20, z: -0.62, above: true },
  { id: 12, label: "Rent, $1,850",       type: "transaction", x: -0.86, y:  0.52, z: -0.44 },
  { id: 13, label: "Standup, daily 9am", type: "event",       x: -0.15, y:  0.30, z: -0.72, above: true },
  { id: 14, label: "“Dana prefers Thu”", type: "memory",      x: -0.30, y:  0.62, z: -0.16 }
];

const EDGES = [
  { a: 0,  b: 1,  relation: "mentions" },
  { a: 1,  b: 2,  relation: "cost" },
  { a: 2,  b: 3,  relation: "matches" },
  { a: 3,  b: 1,  relation: "mentions" },
  { a: 5,  b: 4,  relation: "attends" },
  { a: 4,  b: 1,  relation: "collides with" },
  { a: 6,  b: 1,  relation: "worked on at" },
  { a: 6,  b: 7,  relation: "worked on at" },
  { a: 7,  b: 1,  relation: "competes with" },
  { a: 8,  b: 0,  relation: "owed to" },
  { a: 8,  b: 1,  relation: "delivers" },
  { a: 9,  b: 7,  relation: "drafted for" },
  { a: 9,  b: 10, relation: "written with" },
  { a: 10, b: 2,  relation: "billed by" },
  { a: 11, b: 1,  relation: "deadline for" },
  { a: 11, b: 8,  relation: "blocked by" },
  { a: 12, b: 6,  relation: "paid instead of" },
  { a: 13, b: 1,  relation: "recurs against" },
  { a: 14, b: 5,  relation: "about" },
  { a: 14, b: 4,  relation: "explains" }
];

const TYPE_LABEL = {
  person: "Person", project: "Project", transaction: "Transaction",
  memory: "Memory", event: "Event", place: "Place", intention: "Intention",
  task: "Task", document: "Document"
};


const VIEW = { w: 360, h: 330 };
const CENTRE = { x: VIEW.w / 2, y: VIEW.h / 2 - 6 };
const SPREAD = 132;
const CAMERA = 3.2;

// Rounded before it reaches an attribute. This is a "use client" component doing
// arithmetic that ends up in a coordinate string, and Node and the browser are
// entitled to differ in the last bits — trap #12d. Three decimals is far finer
// than a 360-unit viewBox can express.
const round = (n) => Number(n.toFixed(3));


// Everything about how a record is drawn, derived once from its position, so the
// size, the fade and the label can never disagree about how far away it is.
const PROJECTED = RECORDS
  .map(record => {

    const scale = CAMERA / (CAMERA - record.z);

    // 0 at the far pole, 1 at the near one.
    const depth = (record.z + 1) / 2;

    return {
      ...record,
      sx: round(CENTRE.x + record.x * SPREAD * scale),
      sy: round(CENTRE.y + record.y * SPREAD * scale),
      r: round(3.6 + 3.4 * depth * scale),
      // Far records stay legible rather than fading to nothing: this is content,
      // not atmosphere, and every one of them is still a button.
      dim: round(0.42 + 0.58 * depth),
      // 9.6–11.4 in viewBox units, which is 8.2–9.8 real pixels once the 360-unit
      // viewBox is scaled into a 308px column on a phone. The first attempt used
      // 8.2–10.4 and the far labels rendered at 7.3px there — smaller than the
      // flat 8.6px this diagram had before gaining any depth at all, which is a
      // strange way to improve it. Depth is allowed to make a label quieter; it
      // is not allowed to make it unreadable.
      labelSize: round(9.6 + 1.8 * depth),
      // Below the node by default; above for the one record whose label would
      // otherwise land on a neighbour's. The gap scales with depth so a near
      // node's bigger dot does not sit on its own bigger label.
      labelOffset: round((record.above ? -1 : 1) * (13 + 8 * depth) + (record.above ? -1 : 0))
    };

  })
  // Painted far-to-near so nearer records overlap the ones behind them. This is
  // the strongest depth cue on the whole diagram and it costs one sort, done
  // once at module scope. It is also why the array is not indexed by id
  // anywhere — see recordOf().
  .sort((a, b) => a.z - b.z);


function recordOf(id) {
  return PROJECTED.find(r => r.id === id);
}

function edgesFor(id) {
  return EDGES.filter(e => e.a === id || e.b === id);
}


export default function SceneGraph() {

  const [selected, setSelected] = useState(null);

  const ref = useRef(null);

  // Entrance, and only the entrance: the selection highlight below is plain
  // React state driving attributes, not an animation. A highlight that exists
  // only inside a tween is a highlight that disappears if the tween is
  // interrupted, and this one has to survive a fast tapper.
  useEffect(() => {

    const root = ref.current;

    if (!root) return;

    const dots = root.querySelectorAll("[data-node]");
    const lines = root.querySelectorAll("[data-edge]");
    const names = root.querySelectorAll("[data-name]");

    if (reducedMotion()) {
      utils.set([...dots, ...lines, ...names], { opacity: 1, scale: 1 });
      return;
    }

    utils.set(dots, { opacity: 0, scale: 0 });
    utils.set(names, { opacity: 0 });
    utils.set(lines, { opacity: 0 });

    let timeline = null;

    const observer = new IntersectionObserver((entries) => {

      if (!entries.some(e => e.isIntersecting) || timeline) return;

      observer.disconnect();

      timeline = createTimeline({ defaults: { ease: "out(3)" } });

      // Nodes exist before edges do, here and in the database: links.js refuses
      // to create an edge to something it cannot find.
      //
      // The dots arrive in paint order, which is depth order, so the net builds
      // from the back forwards — the far records appear first and the near ones
      // land on top of them. Edges fade rather than draw themselves on: at
      // twenty of them, twenty staggered dasharray animations read as noise, and
      // the fade lets the depth-graded opacity below survive the entrance.
      timeline
        .add(dots, { opacity: 1, scale: 1, duration: 460, delay: stagger(46) })
        .add(names, { opacity: 1, duration: 380, delay: stagger(46) }, "-=560")
        .add(lines, { opacity: 1, duration: 520, delay: stagger(28) }, "-=520");

    }, { rootMargin: "0px 0px -20% 0px", threshold: 0 });

    observer.observe(root);

    return () => {
      observer.disconnect();
      timeline?.pause();
      utils.set([...dots, ...lines, ...names], { opacity: 1, scale: 1 });
    };

  }, []);

  const related = selected === null
    ? null
    : new Set(edgesFor(selected).flatMap(e => [e.a, e.b]));

  const chosen = selected === null ? null : recordOf(selected);

  return (
    <>
      <Stage minH="min-h-[30rem]">

        <div ref={ref}>
          <svg
            viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
            className="h-auto w-full"
            fill="none"
            role="img"
            aria-label={`${RECORDS.length} records from ${new Set(RECORDS.map(r => r.type)).size} different tables, connected by ${EDGES.length} links.`}
          >

            {EDGES.map((e, i) => {

              const on = selected !== null && (e.a === selected || e.b === selected);
              const off = selected !== null && !on;

              const from = recordOf(e.a);
              const to = recordOf(e.b);

              // An edge is only as present as the records it joins. Averaging
              // their depth is what stops the back of the net reading as a flat
              // grey mesh laid over the front of it.
              const depth = (from.dim + to.dim) / 2;

              return (
                <line
                  key={i}
                  data-edge
                  x1={from.sx} y1={from.sy}
                  x2={to.sx} y2={to.sy}
                  stroke={on ? "var(--moss)" : "var(--line)"}
                  strokeWidth={on ? 2 : 1}
                  style={{
                    opacity: off ? 0.12 : (on ? 1 : depth * 0.85),
                    transition: "stroke 200ms, opacity 200ms, stroke-width 200ms"
                  }}
                />
              );

            })}

            {PROJECTED.map(n => {

              const isSelected = n.id === selected;
              const isNeighbour = related?.has(n.id) && !isSelected;
              const dimmed = selected !== null && !isSelected && !isNeighbour;

              return (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${TYPE_LABEL[n.type]}: ${n.label}`}
                  onClick={() => setSelected(isSelected ? null : n.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(isSelected ? null : n.id);
                    }
                  }}
                  className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-ink"
                  style={{ opacity: dimmed ? 0.22 : n.dim, transition: "opacity 200ms" }}
                >

                  {/* The touch target, and it is deliberately the same size for
                      a far record as a near one. Perspective is a drawing
                      convention; a fingertip is a fingertip. 22 units on a
                      360-unit viewBox is roughly 44px once scaled to a phone. */}
                  <circle cx={n.sx} cy={n.sy} r="22" fill="transparent" strokeWidth="2" stroke="transparent" />

                  <circle
                    data-node
                    className="pos-pop"
                    cx={n.sx} cy={n.sy}
                    r={isSelected ? n.r + 2.5 : n.r}
                    fill={isSelected || isNeighbour ? "var(--moss)" : "var(--ink-soft)"}
                    style={{ transition: "r 200ms, fill 200ms" }}
                  />

                  <text
                    data-name
                    x={n.sx} y={round(n.sy + n.labelOffset)}
                    textAnchor="middle"
                    fontSize={n.labelSize}
                    className="pos-data"
                    fill={isSelected ? "var(--ink)" : "var(--ink-soft)"}
                  >
                    {n.label}
                  </text>

                </g>
              );

            })}

          </svg>
        </div>

        {/* The caption is the accessible version of the highlight. The graph
            above says it in position and colour, this says it in words. */}
        <div className="mt-4 min-h-[7rem] rounded-item bg-[var(--sunken)] px-4 py-3" aria-live="polite">
          {chosen ? (
            <>
              <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
                {TYPE_LABEL[chosen.type]} · {edgesFor(chosen.id).length} links
              </p>
              <ul className="mt-2 space-y-1.5">
                {edgesFor(chosen.id).map((e, i) => {
                  const other = recordOf(e.a === chosen.id ? e.b : e.a);
                  return (
                    <li key={i} className="text-[0.85rem] leading-snug text-ink">
                      <span className="text-ink-soft">{chosen.label}</span>
                      <span className="pos-data mx-1.5 text-moss">{e.relation}</span>
                      <span className="text-ink-soft">{other.label}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-[0.85rem] leading-relaxed text-ink-soft">
              Fifteen records from nine different tables, sitting at different
              depths because a real one has no single layer. Tap any of them: a
              charge reaches the project it paid for, a task reaches the person
              it is owed to, a memory about someone reaches the evening it
              explains. Nothing here was tagged by hand.
            </p>
          )}
        </div>

      </Stage>

      <TapHint>Tap any node, near or far. Tap it again to clear.</TapHint>
    </>
  );

}
