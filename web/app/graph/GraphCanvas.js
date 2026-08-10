"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceX, forceY } from "d3-force";
import { typeName, detail, nodeToRoot, moneyTotal } from "./phrasing.js";
import { reducedMotion } from "../motion.js";


// The whole graph, alive, fullscreen.
//
// This replaced a deterministic radial view that drew one neighbourhood at a
// time — the user's call, and right: the thing a linked personal graph is FOR
// is watching your whole life settle into clusters you didn't draw. The
// density work is what made that defensible; at 37 edges a force layout is a
// dandelion, at ~300 with real hubs it is a net.
//
// ── Why force-graph, of the candidates offered ───────────────────────────
//
// The 2D sibling of 3d-force-graph — same author, same API. Obsidian's own
// graph is 2D: three.js is ~600KB against this library's ~80, phones pay for
// WebGL scenes in battery, and labels in a 3D scene are unreadable at most
// camera angles. Sigma earns its keep at tens of thousands of nodes and this
// graph is bounded at 5,000 edges by construction. Cytoscape settles into
// analysis diagrams, and this page is meant to feel like a place.
//
// A literal 3D sphere was considered and declined for the same reasons — but
// the three problems it was reached for are solved here in 2D: the world is
// BOUNDED (weak centring forces mean disconnected islands share one compact
// space instead of repelling each other into an expanseless plane), the
// camera AUTO-FRAMES until the user takes it, and one SPREAD control grows or
// shrinks the whole world. If the sphere is still wanted after living with
// this, it is the same author's 3D API one import away.
//
// ── What the canvas may not do ───────────────────────────────────────────
//
// Colour carries meaning in this app and the canvas gets no exemption: four
// families map to the identity colours and ember appears nowhere — a graph
// has nothing waiting on anybody. Node size is distinct-neighbour degree,
// computed server-side: the honest proxy for importance. Money totals shown
// on selection are summed in code from amounts the server attached — never a
// model's arithmetic.


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
// the square root. The floor keeps a leaf visible; the cap stops Groceries
// (43 neighbours) from becoming a moon.
function radiusOf(node) {
  return Math.min(3 + 2.1 * Math.sqrt(node.val || 1), 18);
}


// One number that means "how big is the world". It drives the three forces
// that define scale together — repulsion, link length, personal space — so
// they can never be tuned into disagreement, and it is what the spread slider
// moves. As the graph grows, nudging this one value is how the world grows
// with it instead of the camera zooming ever further out.
function applySpread(fg, factor) {

  fg.d3Force("charge").strength(-26 * factor * factor);
  fg.d3Force("link").distance(26 * factor);
  fg.d3Force("collide", forceCollide(node => (radiusOf(node) + 3) * (0.7 + 0.5 * factor)));

  // The leash that makes disconnected islands share one world. Without it,
  // components with no edge between them repel each other for as long as the
  // simulation runs — which on this data meant two islands drifting apart for
  // fifteen seconds and a final frame too far out to read. Weak, deliberately:
  // it must gather, not crush. Slightly stronger when the world is spread, so
  // growing the spread grows the layout rather than the drift.
  fg.d3Force("x", forceX(0).strength(0.05 + 0.02 * factor));
  fg.d3Force("y", forceY(0).strength(0.05 + 0.02 * factor));

}


const SPREAD_MIN = 0.6;
const SPREAD_MAX = 1.8;


export default function GraphCanvas({ nodes, links, focus = null }) {

  const containerRef = useRef(null);
  const fgRef = useRef(null);

  const [selected, setSelected] = useState(null);
  const [hiddenFamilies, setHiddenFamilies] = useState(() => new Set());
  const [spread, setSpread] = useState(1);

  // Canvas callbacks fire every frame and close over their creation scope, so
  // everything they need lives in refs the React handlers keep current.
  const selectedRef = useRef(null);
  const neighboursRef = useRef(new Set());
  const hiddenRef = useRef(hiddenFamilies);
  const paletteRef = useRef(null);

  // Whether the user has taken the camera. Until they touch the canvas, the
  // view re-frames the whole graph every engine tick — so the settle plays
  // out ON SCREEN, framed, instead of half off the edge until a final jump.
  // The first touch ends it: a camera the user is holding must never move
  // itself.
  const cameraOwnedRef = useRef(false);

  // Labels drawn this frame, in graph coordinates. Reset before each frame,
  // checked before every label — the overlap rule that keeps a zoomed-mid
  // view readable instead of forty labels landing at once on top of each
  // other. Draw order is by degree (see the sort below), so when two labels
  // want one spot, the more connected thing wins.
  const labelRectsRef = useRef([]);


  const adjacency = useMemo(() => {

    const map = new Map();

    for (const link of links) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source).add(link.target);
      map.get(link.target).add(link.source);
    }

    return map;

  }, [links]);


  // Connected components — the islands. Each is titled by its most connected
  // member, which is the name a person would give it: the Trifilm island, the
  // Groceries island. Drawn as overview captions when zoomed out, they are
  // what makes the wide view legible instead of anonymous constellations —
  // and when future data joins two islands, the union-find simply reports one
  // component with one title, no code change.
  const components = useMemo(() => {

    const parent = new Map(nodes.map(n => [n.id, n.id]));

    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };

    for (const link of links) {
      const a = find(link.source);
      const b = find(link.target);
      if (a !== b) parent.set(a, b);
    }

    const byRoot = new Map();

    for (const node of nodes) {
      const root = find(node.id);
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(node);
    }

    return [...byRoot.values()]
      .filter(members => members.length >= 3)
      .map(members => {
        const strongest = members.reduce((a, b) => ((b.val || 0) > (a.val || 0) ? b : a));
        return { title: strongest.label, ids: members.map(m => m.id) };
      });

  }, [nodes, links]);


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

    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { paletteRef.current = readPalette(); };
    scheme.addEventListener("change", onScheme);

    // Any pointer on the canvas hands the camera to the user, permanently
    // (the recentre button hands it back). Capture phase, so this wins the
    // race against the zoom handler the library installs.
    const takeCamera = () => { cameraOwnedRef.current = true; };
    el.addEventListener("pointerdown", takeCamera, { capture: true });

    // Sorted by degree, descending, ONCE — this is draw order, and draw order
    // is label priority: when two labels collide, the hub keeps its name and
    // the leaf waits for a closer zoom.
    const liveNodes = nodes.map(n => ({ ...n })).sort((a, b) => (b.val || 0) - (a.val || 0));
    const liveById = new Map(liveNodes.map(n => [n.id, n]));

    // Component members as references into the live array, so centroids track
    // the physics without a per-frame lookup.
    const liveComponents = components.map(c => ({
      title: c.title,
      members: c.ids.map(id => liveById.get(id)).filter(Boolean)
    }));

    // The library touches window at import time — a static import would put
    // it in the server bundle and kill the page at build.
    import("force-graph").then(({ default: ForceGraph }) => {

      if (disposed) return;

      const still = reducedMotion();

      const isDim = (node) =>
        (selectedRef.current &&
          node.id !== selectedRef.current &&
          !neighboursRef.current.has(node.id));

      fg = new ForceGraph(el)
        .graphData({ nodes: liveNodes, links: links.map(l => ({ ...l })) })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")

        // You can always find your way back: zoom is clamped, and the world
        // itself is leashed by applySpread(), so there is no expanseless
        // plane to get lost in.
        .minZoom(0.3)
        .maxZoom(10)

        // A settle measured in a few seconds, not fifteen — the long default
        // cooldown was most of the "two islands half off screen" wait.
        .d3AlphaDecay(0.028)
        .d3VelocityDecay(0.35)
        .warmupTicks(still ? 300 : 60)
        .cooldownTicks(still ? 0 : undefined)
        .cooldownTime(4000)

        .nodeVal(n => n.val || 1)
        .nodeLabel(() => "")

        .onRenderFramePre(() => { labelRectsRef.current = []; })

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

          // Labels arrive with zoom, biggest first — scale × √degree crosses
          // the threshold earlier for a hub than a leaf, so names appear a few
          // at a time instead of forty at once...
          const wants =
            isSelected || isNeighbour ||
            scale * Math.sqrt(node.val || 1) > 3.2;

          if (wants && !dimmed) {

            const size = Math.max(11 / scale, 1.6);

            ctx.font = `${size}px "DM Mono", ui-monospace, monospace`;

            // ...and the ones that do arrive are not allowed to land on each
            // other. A label that would overlap one already drawn this frame
            // is skipped (the selection always speaks). Priority is draw
            // order, which is degree order.
            const width = ctx.measureText(node.label).width;
            const rect = { x: node.x - width / 2, y: node.y + r + 2 / scale, w: width, h: size };

            const collides = labelRectsRef.current.some(other =>
              rect.x < other.x + other.w && rect.x + rect.w > other.x &&
              rect.y < other.y + other.h && rect.y + rect.h > other.y
            );

            if (!collides || isSelected) {

              labelRectsRef.current.push(rect);

              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.lineWidth = 3 / scale;
              ctx.strokeStyle = palette.paper;
              ctx.strokeText(node.label, node.x, rect.y);
              ctx.fillStyle = isSelected ? palette.ink : palette.inkSoft;
              ctx.fillText(node.label, node.x, rect.y);

            }

          }

          ctx.globalAlpha = 1;

        })

        // The island captions. When the view is wide enough that node labels
        // have gone, each component says its name at its centroid — the
        // overview stops being anonymous constellations. They fade out as the
        // node labels fade in, so the two layers never shout over each other.
        .onRenderFramePost((ctx, scale) => {

          if (scale >= 1.1) return;

          const palette = paletteRef.current;
          const alpha = Math.min(1, (1.1 - scale) / 0.25);

          for (const component of liveComponents) {

            const visible = component.members.filter(
              m => !hiddenRef.current.has(FAMILY[m.type] || "notes")
            );

            if (visible.length < 3) continue;

            let cx = 0, cy = 0;
            for (const m of visible) { cx += m.x || 0; cy += m.y || 0; }
            cx /= visible.length;
            cy /= visible.length;

            const size = 13 / scale;

            ctx.globalAlpha = alpha;
            ctx.font = `${size}px "DM Mono", ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineWidth = 4 / scale;
            ctx.strokeStyle = palette.paper;
            ctx.strokeText(component.title, cx, cy);
            ctx.fillStyle = palette.ink;
            ctx.fillText(component.title, cx, cy);
            ctx.globalAlpha = 1;

          }

        })

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
          cameraOwnedRef.current = true;
          select(node);
          fg.centerAt(node.x, node.y, 500);
          if (fg.zoom() < 2) fg.zoom(2.2, 500);
        })
        .onBackgroundClick(() => select(null))

        // The camera never trusts the physics. Until the user takes over, the
        // whole graph is re-framed every tick — the settle happens on screen,
        // framed, instead of drifting half off a phone edge and then jumping.
        .onEngineTick(() => {
          if (!cameraOwnedRef.current) fg.zoomToFit(0, 60);
        })

        .onEngineStop(() => {

          // A deep link from a project, person or insight card lands centred
          // and selected on that thing — the contract those links have
          // carried since the first version of this page.
          const target = focus && fg.graphData().nodes.find(n => n.id === focus);

          if (target && !cameraOwnedRef.current) {
            cameraOwnedRef.current = true;
            select(target);
            fg.centerAt(target.x, target.y, 700);
            fg.zoom(2.4, 700);
            return;
          }

          // One last authoritative fit. The per-tick refit above depends on
          // ticks actually happening, and cooldownTime is wall-clock — a tab
          // that loads in the background has its animation frames paused
          // while the clock runs, so the engine can stop having barely
          // ticked. Whatever the route here, the settled graph ends framed.
          if (!cameraOwnedRef.current) fg.zoomToFit(400, 60);

        });

      applySpread(fg, 1);

      fg.zoomToFit(0, 60);

      fgRef.current = fg;

      observer = new ResizeObserver(() => {
        fg.width(el.clientWidth);
        fg.height(el.clientHeight);
      });

      observer.observe(el);

    });

    return () => {
      disposed = true;
      scheme.removeEventListener("change", onScheme);
      el.removeEventListener("pointerdown", takeCamera, { capture: true });
      observer?.disconnect();
      fg?._destructor();
      fgRef.current = null;
    };

    // The graph itself is load-time data; selection, filters and spread act
    // through refs so the engine (and its settled layout) is never rebuilt.
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
    if (selected && hiddenRef.current.has(FAMILY[selected.type] || "notes")) select(null);
  };


  const changeSpread = (value) => {

    setSpread(value);

    const fg = fgRef.current;

    if (!fg) return;

    applySpread(fg, value);

    // Reheat so the world actually re-settles at the new scale — and let the
    // camera follow it if the user hasn't claimed it.
    fg.d3ReheatSimulation();

  };


  const recentre = () => {
    cameraOwnedRef.current = false;
    fgRef.current?.zoomToFit(500, 60);
  };


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
          direction: l.source === selected.id ? "out" : "in"
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.node.val || 0) - (a.node.val || 0));

  }, [selected, nodes, links]);


  // What this selection's neighbourhood costs — summed in code from the
  // amounts already on the transaction nodes. A merchant's total is its
  // charges, a category's is the charges in it, a project's is the charges
  // spent on it.
  const money = useMemo(
    () => moneyTotal(neighbourRows.map(row => row.node)),
    [neighbourRows]
  );


  const walkTo = (node) => {
    const fg = fgRef.current;
    const live = fg?.graphData().nodes.find(n => n.id === node.id);
    if (!live) return;
    cameraOwnedRef.current = true;
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

      <div ref={containerRef} className="absolute inset-0" />

      <header className="pointer-events-none absolute left-5 top-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="pos-display text-[1.35rem] text-ink">Connections</h1>
        <p className="pos-data mt-0.5 text-[0.7rem] text-ink-soft">
          {nodes.length} things · {links.length} links
        </p>
      </header>

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

      {/* World controls, tucked above the tab bar. Hidden while a selection
          card is up — the card owns that space. */}
      {!selected && (
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+6rem)] right-3 flex flex-col items-end gap-2">

          <button
            onClick={recentre}
            aria-label="Fit the whole graph on screen"
            className="grid h-10 w-10 place-items-center rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 text-ink-soft shadow-lift backdrop-blur-xl hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[17px] w-[17px]" aria-hidden="true">
              <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5V9" />
              <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
              <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
              <path d="M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </button>

          {/* The "grow the world" control: one slider moving repulsion, link
              length and personal space together, then re-settling. This is
              how the graph accommodates growth — spread the world, not the
              camera. */}
          <label className="flex items-center gap-2 rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 px-3 py-2 shadow-lift backdrop-blur-xl">
            <span className="pos-data text-[0.65rem] text-ink-soft">Spread</span>
            <input
              type="range"
              min={SPREAD_MIN}
              max={SPREAD_MAX}
              step="0.05"
              value={spread}
              onChange={(e) => changeSpread(Number(e.target.value))}
              aria-label="How spread out the graph is"
              className="w-24 accent-[var(--moss)]"
            />
          </label>

        </div>
      )}

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
                {money.count > 0 && (
                  <p className="pos-data mt-1 text-[0.72rem] text-moss">
                    ${money.total.toFixed(2)} across {money.count} charge{money.count === 1 ? "" : "s"}
                  </p>
                )}
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
