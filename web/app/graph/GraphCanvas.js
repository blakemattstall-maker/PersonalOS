"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide } from "d3-force";
import { typeName, detail, nodeToRoot } from "./phrasing.js";
import { reducedMotion } from "../motion.js";


// The whole graph, alive, fullscreen.
//
// This replaced a deterministic radial view that drew one neighbourhood at a
// time. That view was honest and testable and the user was right that it was
// not the feature: the thing a linked personal graph is FOR — the Obsidian
// moment — is seeing your whole life settle into clusters you didn't draw.
// The density work is what made the switch defensible: at 37 edges a force
// layout is a dandelion, at ~300 with real hubs it is a net.
//
// ── Why force-graph, of the three candidates ─────────────────────────────
//
// The 2D sibling of 3d-force-graph — same author, same API. Chosen over the
// 3D one because Obsidian's own graph is 2D: three.js is ~600KB against this
// library's ~80, phones pay for WebGL scenes in battery, and labels in a 3D
// scene are unreadable at most camera angles. Chosen over sigma.js because
// sigma's WebGL machinery earns its keep at tens of thousands of nodes and
// this graph is bounded at 5,000 edges by construction. Chosen over
// cytoscape.js because that is an analysis tool — its layouts settle into
// diagrams, and this page is meant to feel like a place, not a figure.
// If 3D is ever wanted, it is the same author's API one import away.
//
// ── What the canvas may not do ───────────────────────────────────────────
//
// Colour carries meaning in this app and the canvas gets no exemption: the
// four families below map to the identity colours (iris/tide/moss/ink) and
// ember appears nowhere — a graph has nothing waiting on anybody. Node size
// is distinct-neighbour degree, computed server-side: the honest proxy for
// importance, derived from facts, no model involved.


// Fourteen types is too many to read as colour. Four families is exactly the
// number of identity colours the design system has, and the grouping is the
// one a person would make: who, what I'm doing, what it costs, what I wrote.
const FAMILY = {
  person: "people",
  project: "work", task: "work", event: "work", deep_thought: "work",
  transaction: "money", merchant: "money", category: "money",
  memory: "notes", note: "notes", intention: "notes",
  nudge: "notes", news_item: "notes", place: "notes"
};

const FAMILIES = [
  { key: "people", label: "People", cssVar: "--iris" },
  { key: "work", label: "Projects", cssVar: "--tide" },
  { key: "money", label: "Money", cssVar: "--moss" },
  { key: "notes", label: "Notes", cssVar: "--ink-soft" }
];


// The canvas cannot read CSS variables, so the palette is materialised once
// per colour scheme. Everything drawn derives from these seven values, which
// is what keeps dark mode one listener instead of a parallel style sheet.
function readPalette() {

  const style = getComputedStyle(document.documentElement);

  const v = (name, fallback) => (style.getPropertyValue(name) || fallback).trim();

  return {
    paper: v("--paper", "#efeee9"),
    ink: v("--ink", "#37424a"),
    inkSoft: v("--ink-soft", "#5e6a70"),
    line: v("--line", "#b9c0bf"),
    moss: v("--moss", "#4a6b62"),
    family: Object.fromEntries(FAMILIES.map(f => [f.key, v(f.cssVar, "#5e6a70")]))
  };

}


// Area, not radius, is what the eye reads as quantity — so radius grows with
// the square root. The +3 floor keeps a leaf tappable-adjacent; the cap stops
// Groceries (43 neighbours) from becoming a moon.
function radiusOf(node) {
  return Math.min(3 + 2.1 * Math.sqrt(node.val || 1), 18);
}


export default function GraphCanvas({ nodes, links, focus = null }) {

  const containerRef = useRef(null);
  const fgRef = useRef(null);

  const [selected, setSelected] = useState(null);
  const [hiddenFamilies, setHiddenFamilies] = useState(() => new Set());

  // Canvas callbacks fire every frame and close over their creation scope, so
  // state they need lives in refs the React handlers keep current.
  const selectedRef = useRef(null);
  const neighboursRef = useRef(new Set());
  const hiddenRef = useRef(hiddenFamilies);
  const paletteRef = useRef(null);

  // id -> Set of neighbour ids, for the selection halo.
  const adjacency = useMemo(() => {

    const map = new Map();

    for (const link of links) {
      // force-graph mutates link.source/.target from id strings into node
      // objects once the engine takes them, so this must run on the raw props.
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source).add(link.target);
      map.get(link.target).add(link.source);
    }

    return map;

  }, [links]);

  const counts = useMemo(() => {

    const byFamily = { people: 0, work: 0, money: 0, notes: 0 };

    for (const node of nodes) byFamily[FAMILY[node.type] || "notes"] += 1;

    return byFamily;

  }, [nodes]);


  const select = (node) => {
    selectedRef.current = node ? node.id : null;
    neighboursRef.current = node ? (adjacency.get(node.id) || new Set()) : new Set();
    setSelected(node ? { ...node } : null);
  };


  useEffect(() => {

    const el = containerRef.current;

    if (!el || nodes.length === 0) return;

    let disposed = false;
    let fg = null;
    let observer = null;

    paletteRef.current = readPalette();

    // Re-materialise the palette when the scheme flips, and repaint. The
    // engine keeps running; only the colours change.
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { paletteRef.current = readPalette(); };
    scheme.addEventListener("change", onScheme);

    // The library touches window at import time, which is why it arrives via
    // dynamic import inside an effect instead of at module scope — a static
    // import would put it in the server bundle and kill the page at build.
    import("force-graph").then(({ default: ForceGraph }) => {

      if (disposed) return;

      const still = reducedMotion();

      const isDim = (node) =>
        (selectedRef.current &&
          node.id !== selectedRef.current &&
          !neighboursRef.current.has(node.id));

      fg = new ForceGraph(el)
        .graphData({
          nodes: nodes.map(n => ({ ...n })),
          links: links.map(l => ({ ...l }))
        })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")

        // Physics tuned for the Obsidian feel: enough repulsion that clusters
        // breathe, collision so hubs don't swallow their leaves, and a slow
        // settle rather than a snap.
        .d3VelocityDecay(0.32)
        .warmupTicks(still ? 300 : 60)
        .cooldownTicks(still ? 0 : undefined)

        .nodeVal(n => n.val || 1)
        .nodeLabel(() => "")

        .nodeCanvasObject((node, ctx, scale) => {

          const palette = paletteRef.current;
          const r = radiusOf(node);
          const isSelected = node.id === selectedRef.current;
          const isNeighbour = neighboursRef.current.has(node.id);
          const dimmed = isDim(node);

          ctx.globalAlpha = dimmed ? 0.1 : 1;

          ctx.beginPath();
          ctx.arc(node.x, node.y, isSelected ? r + 2 : r, 0, Math.PI * 2);
          ctx.fillStyle = isSelected || isNeighbour
            ? palette.moss
            : palette.family[FAMILY[node.type] || "notes"];
          ctx.fill();

          if (isSelected) {
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = palette.ink;
            ctx.stroke();
          }

          // Labels arrive with zoom, exactly like Obsidian: hubs first, then
          // everything. A halo in the page colour keeps a label legible when
          // it crosses somebody else's spoke.
          const showLabel =
            isSelected || isNeighbour ||
            (scale > 1.1 && (node.val || 1) >= 4) ||
            scale > 2.4;

          if (showLabel && !dimmed) {

            const size = Math.max(11 / scale, 2.2);

            ctx.font = `${size}px "DM Mono", ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.lineWidth = 3 / scale;
            ctx.strokeStyle = palette.paper;
            ctx.strokeText(node.label, node.x, node.y + r + 2 / scale);
            ctx.fillStyle = isSelected ? palette.ink : palette.inkSoft;
            ctx.fillText(node.label, node.x, node.y + r + 2 / scale);

          }

          ctx.globalAlpha = 1;

        })

        // The whole dot plus slack is tappable — a thumb is not a cursor.
        .nodePointerAreaPaint((node, colour, ctx) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radiusOf(node) + 7, 0, Math.PI * 2);
          ctx.fillStyle = colour;
          ctx.fill();
        })

        .linkColor(link => {
          const palette = paletteRef.current;
          const sel = selectedRef.current;
          if (!sel) return palette.line;
          const a = link.source.id ?? link.source;
          const b = link.target.id ?? link.target;
          return a === sel || b === sel ? palette.moss : palette.line;
        })
        .linkWidth(link => {
          const sel = selectedRef.current;
          const a = link.source.id ?? link.source;
          const b = link.target.id ?? link.target;
          return sel && (a === sel || b === sel) ? 1.6 : 0.7;
        })

        .nodeVisibility(n => !hiddenRef.current.has(FAMILY[n.type] || "notes"))
        .linkVisibility(l => {
          const a = l.source.id ?? l.source;
          const b = l.target.id ?? l.target;
          const type = (id) => id.slice(0, id.indexOf(":"));
          return !hiddenRef.current.has(FAMILY[type(a)] || "notes")
            && !hiddenRef.current.has(FAMILY[type(b)] || "notes");
        })

        .onNodeClick(node => {
          select(node);
          fg.centerAt(node.x, node.y, 500);
          if (fg.zoom() < 2) fg.zoom(2.2, 500);
        })
        .onBackgroundClick(() => select(null))

        .d3Force("collide", forceCollide(node => radiusOf(node) + 2));

      fg.d3Force("charge").strength(-45);

      fgRef.current = fg;

      // The camera never trusts the physics to land on-screen. The simulation
      // is free to drift — there is nothing anchoring it to the viewport, and
      // the first render proved it by settling the whole net half off the
      // right edge of a phone. So: frame everything immediately (the warmup
      // ticks have already given every node a position), and frame it again
      // when the engine stops, unless a deep link has claimed the camera.
      //
      // A deep link from a project, person or insight card lands centred and
      // selected on that thing — the contract those links have carried since
      // the first version of this page.
      fg.zoomToFit(0, 70);

      let settled = false;

      fg.onEngineStop(() => {

        if (settled) return;
        settled = true;

        const target = focus && fg.graphData().nodes.find(n => n.id === focus);

        if (target) {
          select(target);
          fg.centerAt(target.x, target.y, 700);
          fg.zoom(2.4, 700);
        } else {
          fg.zoomToFit(500, 70);
        }

      });

      observer = new ResizeObserver(() => {
        fg.width(el.clientWidth);
        fg.height(el.clientHeight);
      });

      observer.observe(el);

    });

    return () => {
      disposed = true;
      scheme.removeEventListener("change", onScheme);
      observer?.disconnect();
      fg?._destructor();
      fgRef.current = null;
    };

    // The graph itself is load-time data; selection and filters act through
    // refs so the engine (and its settled layout) is never rebuilt for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, focus]);


  const toggleFamily = (key) => {
    setHiddenFamilies(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      hiddenRef.current = next;
      return next;
    });
    // Clearing a selection whose node just vanished, rather than leaving a
    // card describing something no longer on screen.
    if (selected && hiddenRef.current.has(FAMILY[selected.type] || "notes")) select(null);
  };


  // The selected node's neighbours as readable rows — the traversal surface.
  // Sorted strongest-first so the list starts with the connections that
  // matter, and every row is a door: tapping one walks the selection there.
  const neighbourRows = useMemo(() => {

    if (!selected) return [];

    const byId = new Map(nodes.map(n => [n.id, n]));

    return links
      .filter(l => l.source === selected.id || l.target === selected.id)
      .map(l => {
        const otherId = l.source === selected.id ? l.target : l.source;
        const other = byId.get(otherId);
        return other && {
          node: other,
          relation: l.relation,
          // walk()'s convention: "out" means the stored edge points away from
          // the thing in focus. phrasing.js turns that into the right sentence.
          direction: l.source === selected.id ? "out" : "in"
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.node.val || 0) - (a.node.val || 0));

  }, [selected, nodes, links]);


  const walkTo = (node) => {
    const fg = fgRef.current;
    const live = fg?.graphData().nodes.find(n => n.id === node.id);
    if (!live) return;
    select(live);
    fg.centerAt(live.x, live.y, 500);
    if (fg.zoom() < 2) fg.zoom(2.2, 500);
  };


  if (nodes.length === 0) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-paper px-8">
        <p className="max-w-[26rem] text-center text-[0.9rem] leading-relaxed text-ink-soft">
          Nothing is connected yet. The graph is built each night from what you
          capture — a note that names a person, a charge at a shop you know.
          Once the links exist, this page becomes them.
        </p>
      </div>
    );
  }


  return (
    <div className="fixed inset-0 bg-paper">

      {/* The canvas owns the whole viewport; everything else floats over it. */}
      <div ref={containerRef} className="absolute inset-0" />

      <header className="pointer-events-none absolute left-5 top-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="pos-display text-[1.35rem] text-ink">Connections</h1>
        <p className="pos-data mt-0.5 text-[0.7rem] text-ink-soft">
          {nodes.length} things · {links.length} links
        </p>
      </header>

      {/* Family chips: legend and filter in one. Dimming a family keeps the
          physics (the layout must not reshuffle under your thumb); it only
          stops drawing them. */}
      <div className="absolute inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] flex flex-wrap justify-center gap-1.5 px-4">
        {FAMILIES.map(family => {
          const off = hiddenFamilies.has(family.key);
          return (
            <button
              key={family.key}
              onClick={() => toggleFamily(family.key)}
              aria-pressed={!off}
              className={`pos-data flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 px-3 py-1.5 text-[0.7rem] backdrop-blur-xl transition-opacity ${
                off ? "opacity-40" : ""
              } text-ink-soft`}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: `var(${family.cssVar})` }}
              />
              {family.label}
              <span className="opacity-60">{counts[family.key]}</span>
            </button>
          );
        })}
      </div>

      {/* The selection card: what this is, what it touches, and doors to walk
          through. Sits above the tab bar, scrolls internally, never covers
          the node you tapped (the canvas centred it above the card). */}
      {selected && (
        <div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] mx-auto max-w-[26rem]">
          <div className="max-h-[42vh] overflow-y-auto rounded-card bg-card/95 p-4 shadow-lift backdrop-blur-xl">

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="pos-data text-[0.65rem] uppercase tracking-[0.12em] text-ink-soft">
                  {typeName(selected.type)}
                  {detail(selected) && ` · ${detail(selected)}`}
                  {` · ${selected.val || 0} connection${(selected.val || 0) === 1 ? "" : "s"}`}
                </p>
                <h2 className="mt-1 text-[0.95rem] leading-snug text-ink">{selected.label}</h2>
              </div>
              <button
                onClick={() => select(null)}
                aria-label="Close"
                className="pos-data shrink-0 rounded-[var(--r-pill)] border border-[var(--line)] px-2.5 py-1 text-[0.7rem] text-ink-soft hover:text-ink"
              >
                ✕
              </button>
            </div>

            {neighbourRows.length > 0 && (
              <ul className="mt-3 space-y-0.5 border-t border-[var(--line)] pt-2">
                {neighbourRows.map(({ node, relation, direction }) => (
                  <li key={node.id}>
                    <button
                      onClick={() => walkTo(node)}
                      className="w-full rounded-item px-2 py-1.5 text-left transition-colors hover:bg-[var(--sunken)]"
                    >
                      <span className="block truncate text-[0.85rem] text-ink">{node.label}</span>
                      <span className="pos-data text-[0.65rem] text-ink-soft">
                        {nodeToRoot({ relation, direction })}
                        {detail(node) && ` · ${detail(node)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

          </div>
        </div>
      )}

    </div>
  );

}
