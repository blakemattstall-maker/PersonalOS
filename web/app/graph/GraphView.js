"use client";

import { useState, useTransition } from "react";
import { walkGraphAction } from "../actions.js";
import { btn } from "../ui.js";
import { layout, VIEW, CENTRE } from "./geometry.js";
import { typeName, nodeToRoot, rootToNode, shorten, detail } from "./phrasing.js";


// One thing, and everything it touches.
//
// The obvious version of this page is the whole graph on one canvas, and it is
// the wrong one. The real graph is a star: one project holds most of the edges,
// a few nodes hold a handful each, and everything else is a leaf. Drawn all at
// once that is a dandelion and a scatter of orphaned pairs — strictly less
// legible than the fictional net on /welcome, which would be an odd thing for
// the real page to be.
//
// So this draws a neighbourhood, and every neighbour is a door into its own.
// walk() already returns exactly this and is already bounded; nothing here
// widens it.
//
// ── Why there is no layout library ───────────────────────────────────────
//
// A force simulation solves "thousands of nodes, no natural arrangement". This
// has at most sixty and a completely natural arrangement: one centre, neighbours
// grouped by which table they came from. A simulation would scatter those groups
// into a lumpy ring and destroy the single most informative thing on the screen
// — that one project reaches into four different tables. It also could not be
// server-rendered, could not read the CSS variables the whole design system
// runs on, and would add more bytes than this entire page.
//
// The layout below is deterministic: same data, same picture, every time, on
// the server and in the browser alike.


export default function GraphView({ anchors, initial }) {

  const [view, setView] = useState(initial);
  const [selected, setSelected] = useState(null);
  const [failed, setFailed] = useState(null);

  // Where you have been, so a walk is retraceable. Exploring a graph without
  // this is a series of one-way doors — you land somewhere interesting three
  // hops in and cannot say how you got there.
  const [trail, setTrail] = useState(initial?.root ? [{ ...initial.root }] : []);

  const [isPending, startTransition] = useTransition();

  const centreOn = (node, { rewindTo = null } = {}) => {

    startTransition(async () => {

      const result = await walkGraphAction({ type: node.type, id: node.id });

      // Both failure shapes. A handler that threw arrives from app/backend.js
      // as { error } with no `success` key at all, so testing only
      // `success === false` treats a 500 as a successful empty neighbourhood —
      // which would render as "this is connected to nothing".
      if (result?.success === false || result?.error) {
        setFailed(result.error || "Couldn't load that.");
        return;
      }

      setFailed(null);
      setSelected(null);
      setView(result);

      setTrail(previous => {
        if (rewindTo != null) return previous.slice(0, rewindTo + 1);
        const key = `${result.root.type}:${result.root.id}`;
        // Walking back to somewhere already on the trail truncates rather than
        // appending, so a there-and-back does not grow the crumbs forever.
        const seen = previous.findIndex(step => `${step.type}:${step.id}` === key);
        if (seen >= 0) return previous.slice(0, seen + 1);
        return [...previous, result.root];
      });

    });

  };


  if (!view?.root) {
    return (
      <AnchorList anchors={anchors} onPick={centreOn} pending={isPending} />
    );
  }


  const { placed, sectors } = layout(view.nodes);

  const chosen = placed.find(node => node.key === selected) || null;

  const byType = sectors.map(sector => ({
    ...sector,
    members: placed.filter(node => node.type === sector.type)
  }));


  return (
    <div>

      {/* Where you have been. */}
      {trail.length > 1 && (
        <nav aria-label="Path walked" className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {trail.map((step, index) => (
            <span key={`${step.type}:${step.id}`} className="flex items-center gap-1.5">
              {index > 0 && <span className="pos-data text-[0.7rem] text-ink-soft" aria-hidden="true">→</span>}
              {index === trail.length - 1 ? (
                <span className="pos-data text-[0.7rem] text-ink">{shorten(step.label, 22)}</span>
              ) : (
                <button
                  onClick={() => centreOn(step, { rewindTo: index })}
                  disabled={isPending}
                  className="pos-data text-[0.7rem] text-ink-soft underline decoration-[var(--line)] underline-offset-[3px] hover:text-ink"
                >
                  {shorten(step.label, 22)}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className={`rounded-card bg-card p-4 shadow-lift transition-opacity ${isPending ? "opacity-50" : ""}`}>

        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="h-auto w-full"
          fill="none"
          role="img"
          aria-label={
            `${shorten(view.root.label, 60)} is connected to ${view.nodes.length} thing` +
            `${view.nodes.length === 1 ? "" : "s"} across ${sectors.length} ` +
            `${sectors.length === 1 ? "table" : "different tables"}.`
          }
        >

          {/* Sector arcs, behind everything.
              A 1px hairline in --line vanishes against the dark card and left
              the grouping carried by position alone. At 3px the same colour
              reads as a groove the dots sit in, which is the intent — it must
              stay quieter than the dots and the spokes, not compete with them. */}
          {byType.map(sector => (
            <path
              key={`arc-${sector.type}`}
              d={sector.path}
              stroke="var(--line)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}

          {/* Spokes. Drawn before the dots so a dot always covers its own
              endpoint rather than being crossed by the line. */}
          {placed.map(node => {
            const on = node.key === selected;
            return (
              <line
                key={`edge-${node.key}`}
                x1={CENTRE} y1={CENTRE}
                x2={node.x} y2={node.y}
                stroke={on ? "var(--moss)" : "var(--line)"}
                strokeWidth={on ? 1.8 : 1}
                style={{
                  opacity: selected && !on ? 0.25 : (node.distance > 1 ? 0.5 : 1),
                  transition: "stroke 180ms, opacity 180ms, stroke-width 180ms"
                }}
              />
            );
          })}

          {byType.map(sector => (
            <text
              key={`label-${sector.type}`}
              x={sector.labelX} y={sector.labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9.5"
              className="pos-data"
              fill="var(--ink-soft)"
              /* A halo in the card colour under the glyphs. These labels sit
                 outside the dots but a long one still crosses a neighbouring
                 sector's spoke, and 9.5px type over a stroke is unreadable.
                 paintOrder lays the stroke first so it reads as clearance. */
              stroke="var(--card)"
              strokeWidth="2.6"
              paintOrder="stroke"
            >
              {sector.count} {typeName(sector.type, sector.count)}
            </text>
          ))}

          {placed.map(node => {

            const on = node.key === selected;

            return (
              <g
                key={node.key}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${typeName(node.type)}: ${shorten(node.label, 60)}`}
                onClick={() => setSelected(on ? null : node.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(on ? null : node.key);
                  }
                }}
                className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-ink"
              >

                {/* The touch target, the same size for every node regardless of
                    how it is drawn. 22 units on a 380-unit viewBox is roughly
                    44px once scaled onto a phone. */}
                <circle cx={node.x} cy={node.y} r="22" fill="transparent" strokeWidth="2" stroke="transparent" />

                <circle
                  cx={node.x} cy={node.y}
                  r={on ? 6.5 : (node.distance > 1 ? 3.4 : 4.6)}
                  fill={on ? "var(--moss)" : "var(--ink-soft)"}
                  style={{
                    opacity: selected && !on ? 0.3 : (node.distance > 1 ? 0.6 : 1),
                    transition: "r 180ms, fill 180ms, opacity 180ms"
                  }}
                />

              </g>
            );

          })}

          {/* The centre, last, so it sits above every spoke. */}
          <circle cx={CENTRE} cy={CENTRE} r="9" fill="var(--ink)" />

          <text
            x={CENTRE} y={CENTRE + 24}
            textAnchor="middle"
            fontSize="11.5"
            className="pos-data"
            fill="var(--ink)"
            stroke="var(--card)"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {shorten(view.root.label, 26)}
          </text>

        </svg>

        {/* The accessible version of the highlight, and the part that actually
            says what a dot means. The diagram carries structure; names and
            relations live here and in the list below. */}
        <div className="mt-2 min-h-[4.5rem] rounded-item bg-[var(--sunken)] px-4 py-3" aria-live="polite">
          {chosen ? (
            <>
              <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
                {typeName(chosen.type)}
                {chosen.distance > 1 && " · indirect"}
                {detail(chosen) && ` · ${detail(chosen)}`}
              </p>
              <p className="mt-1.5 text-[0.9rem] leading-snug text-ink">
                <span className="text-ink-soft">{shorten(view.root.label, 28)}</span>
                <span className="pos-data mx-1.5 text-moss">{rootToNode(chosen)}</span>
                {shorten(chosen.label, 60)}
              </p>
              <button
                onClick={() => centreOn(chosen)}
                disabled={isPending}
                className={`${btn("quiet")} mt-3`}
              >
                Centre on this
                <span aria-hidden="true">→</span>
              </button>
            </>
          ) : (
            <p className="text-[0.85rem] leading-relaxed text-ink-soft">
              {view.nodes.length} thing{view.nodes.length === 1 ? "" : "s"} connected to
              this, across {sectors.length} {sectors.length === 1 ? "table" : "different tables"}.
              Tap any dot to see what the connection is.
            </p>
          )}
        </div>

      </div>

      {failed && (
        <p className="mt-3 text-[0.82rem] text-ember-ink">{failed}</p>
      )}

      {/* Every neighbour by name. The diagram cannot label sixty dots without
          becoming unreadable, and it should not try — a diagram is good at
          shape and bad at text. This is the same data as a list, and it is what
          makes the page usable rather than decorative. */}
      <div className="mt-6 space-y-5">
        {byType.map(sector => (
          <section key={`list-${sector.type}`}>

            <h2 className="pos-data mb-2 text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
              {sector.count} {typeName(sector.type, sector.count)}
            </h2>

            <ul className="space-y-1">
              {sector.members.map(node => (
                <li key={`row-${node.key}`}>
                  <button
                    onClick={() => centreOn(node)}
                    disabled={isPending}
                    className={`w-full rounded-item px-3 py-2 text-left transition-colors hover:bg-[var(--sunken)] ${
                      node.key === selected ? "bg-[var(--sunken)]" : ""
                    }`}
                  >
                    <span className="block text-[0.88rem] leading-snug text-ink">
                      {shorten(node.label, 64)}
                    </span>
                    <span className="pos-data mt-0.5 block text-[0.68rem] text-ink-soft">
                      {nodeToRoot(node)}
                      {detail(node) && ` · ${detail(node)}`}
                      {node.distance > 1 && " · indirect"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

          </section>
        ))}
      </div>

      <div className="mt-8 border-t border-[var(--line)] pt-4">
        <AnchorList anchors={anchors} onPick={centreOn} pending={isPending} compact />
      </div>

    </div>
  );

}


// What is worth looking at. Only nodes with more than one edge appear — a leaf's
// neighbourhood is the one thing it hangs off, which is a page that says what
// you already clicked.
function AnchorList({ anchors, onPick, pending, compact = false }) {

  if (!anchors?.length) {
    return (
      <div className="rounded-item bg-[var(--sunken)] px-4 py-5">
        <p className="text-[0.88rem] leading-relaxed text-ink-soft">
          Nothing is connected to more than one thing yet. Connections are built
          each night from what you capture — a note that names a person, a charge
          at a merchant you have been to before. Once there are a few, they show
          up here on their own.
        </p>
      </div>
    );
  }

  return (
    <div>

      <h2 className="pos-data mb-2 text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
        {compact ? "Start somewhere else" : "Most connected"}
      </h2>

      <ul className="space-y-1">
        {anchors.map(anchor => (
          <li key={`${anchor.type}:${anchor.id}`}>
            <button
              onClick={() => onPick(anchor)}
              disabled={pending}
              className="flex w-full items-baseline justify-between gap-3 rounded-item px-3 py-2 text-left transition-colors hover:bg-[var(--sunken)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[0.88rem] text-ink">{shorten(anchor.label, 46)}</span>
                <span className="pos-data text-[0.68rem] text-ink-soft">{typeName(anchor.type)}</span>
              </span>
              <span className="pos-data shrink-0 text-[0.72rem] text-ink-soft">
                {anchor.degree}
              </span>
            </button>
          </li>
        ))}
      </ul>

    </div>
  );

}
