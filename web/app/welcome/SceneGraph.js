"use client";

import { useEffect, useRef, useState } from "react";
import { animate, stagger, createTimeline, createDrawable, reducedMotion, utils } from "../motion.js";
import { Stage, TapHint } from "./parts.js";


// A slice of the graph, shrunk, built from invented sample records.
//
// Every node here comes from a different table: contacts, projects, notes,
// transactions, places, events, intentions. The point of the section is that
// those are normally kept apart. A contact knows nothing about a charge, a
// charge belongs to no project, and an evening set aside belongs to nobody.
const NODES = [
  { id: 0, label: "Priya Raman",         type: "person",      x: 58,  y: 54 },
  { id: 1, label: "Partner deck",        type: "project",     x: 182, y: 42 },
  { id: 2, label: "$146.80 Northline",   type: "transaction", x: 306, y: 76 },
  { id: 3, label: "“Printed the decks”", type: "memory",      x: 296, y: 170 },
  { id: 4, label: "Dinner, Thu 7pm",     type: "event",       x: 176, y: 148 },
  { id: 5, label: "Dana Whitfield",      type: "person",      x: 54,  y: 152 },
  { id: 6, label: "Kestrel Coworking",   type: "place",       x: 82,  y: 248 },
  { id: 7, label: "Onboarding rewrite",  type: "intention",   x: 240, y: 250 }
];

const EDGES = [
  { a: 0, b: 1, relation: "mentions" },
  { a: 1, b: 2, relation: "cost" },
  { a: 2, b: 3, relation: "matches" },
  { a: 3, b: 1, relation: "mentions" },
  { a: 5, b: 4, relation: "attends" },
  { a: 4, b: 1, relation: "collides with" },
  { a: 6, b: 1, relation: "worked on at" },
  { a: 6, b: 7, relation: "worked on at" },
  { a: 7, b: 1, relation: "competes with" }
];

const TYPE_LABEL = {
  person: "Person", project: "Project", transaction: "Transaction",
  memory: "Memory", event: "Event", place: "Place", intention: "Intention"
};


function edgesFor(id) {
  return EDGES.filter(e => e.a === id || e.b === id);
}

function nodeOf(id) {
  return NODES.find(n => n.id === id);
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

    let timeline = null;

    const observer = new IntersectionObserver((entries) => {

      if (!entries.some(e => e.isIntersecting)) return;

      observer.disconnect();

      timeline = createTimeline({ defaults: { ease: "out(3)" } });

      // Nodes exist before edges do, here and in the database: links.js
      // refuses to create an edge to something it cannot find.
      timeline
        .add(dots, { opacity: 1, scale: 1, duration: 460, delay: stagger(70) })
        .add(names, { opacity: 1, duration: 380, delay: stagger(70) }, "-=520")
        .add(createDrawable(lines), {
          draw: ["0 0", "0 1"],
          duration: 560,
          delay: stagger(55),
          ease: "inOut(2)"
        }, "-=420");

    }, { threshold: 0.3 });

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

  const chosen = selected === null ? null : nodeOf(selected);

  return (
    <>
      <Stage minH="min-h-[26rem]">

        <div ref={ref}>
          <svg
            viewBox="0 0 360 290"
            className="h-auto w-full"
            fill="none"
            role="img"
            aria-label="Eight entities from different tables, connected by nine links."
          >

            {EDGES.map((e, i) => {

              const on = selected !== null && (e.a === selected || e.b === selected);
              const off = selected !== null && !on;

              const from = nodeOf(e.a);
              const to = nodeOf(e.b);

              return (
                <line
                  key={i}
                  data-edge
                  x1={from.x} y1={from.y}
                  x2={to.x} y2={to.y}
                  stroke={on ? "var(--moss)" : "var(--line)"}
                  strokeWidth={on ? 2 : 1}
                  style={{ opacity: off ? 0.25 : 1, transition: "stroke 200ms, opacity 200ms, stroke-width 200ms" }}
                />
              );

            })}

            {NODES.map(n => {

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
                  style={{ opacity: dimmed ? 0.3 : 1, transition: "opacity 200ms" }}
                >

                  {/* The touch target. 24px of radius on a 360-unit viewBox is
                      roughly a fingertip once scaled to a phone; the visible
                      dot is 7 and would be unusable on its own. */}
                  <circle cx={n.x} cy={n.y} r="24" fill="transparent" strokeWidth="2" stroke="transparent" />

                  <circle
                    data-node
                    className="pos-pop"
                    cx={n.x} cy={n.y}
                    r={isSelected ? 9 : 6.5}
                    fill={isSelected || isNeighbour ? "var(--moss)" : "var(--ink-soft)"}
                    style={{ transition: "r 200ms, fill 200ms" }}
                  />

                  <text
                    data-name
                    x={n.x} y={n.y + 21}
                    textAnchor="middle"
                    fontSize="10"
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
        <div className="mt-4 min-h-[5.5rem] rounded-item bg-[var(--sunken)] px-4 py-3" aria-live="polite">
          {chosen ? (
            <>
              <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
                {TYPE_LABEL[chosen.type]} · {edgesFor(chosen.id).length} links
              </p>
              <ul className="mt-2 space-y-1.5">
                {edgesFor(chosen.id).map((e, i) => {
                  const other = nodeOf(e.a === chosen.id ? e.b : e.a);
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
              Eight records from seven different tables. Tap one to see what it
              is attached to: a charge to the project it paid for, an evening to
              the person you are spending it with, a workspace to both of the
              things that actually get done there.
            </p>
          )}
        </div>

      </Stage>

      <TapHint>Tap any node. Tap it again to clear.</TapHint>
    </>
  );

}
