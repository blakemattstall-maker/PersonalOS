"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceX, forceY } from "d3-force";
import { typeName, detail, nodeToRoot, moneyTotal } from "./phrasing.js";
import { reducedMotion } from "../motion.js";


// The whole graph, alive, fullscreen — flat by default, spherical on request.
//
// This replaced a deterministic radial view that drew one neighbourhood at a
// time — the user's call, and right: the thing a linked personal graph is FOR
// is watching your whole life settle into clusters you didn't draw.
//
// ── Why force-graph, of the candidates offered ───────────────────────────
//
// The 2D sibling of 3d-force-graph — same author, same API. Obsidian's own
// graph is 2D, and 2D stays the default here: it is ~80KB against three.js's
// ~600, phones pay for WebGL in battery, and canvas labels are legible at
// every zoom. The sphere exists as an opt-in experiment (the user asked for
// it twice, which is a decision): 3d-force-graph loads ONLY when the toggle
// is first tapped, so the everyday page never carries it.
//
// ── Naming what you're looking at ────────────────────────────────────────
//
// Island titles were first drawn on the canvas at each component's centroid,
// and that failed twice at once: a title could be a 20-word intention
// sentence, and at overview zoom several of them landed on the graph and on
// each other. The fix came from the user's sphere idea — the CHROME names
// the view, the canvas never does. A caption under the header tracks
// whichever island dominates the viewport (in 3D: the hemisphere facing the
// camera), and island titles prefer a nameable member — project, person,
// merchant, category, place — over prose, hard-truncated either way.
//
// ── What the canvas may not do ───────────────────────────────────────────
//
// Colour carries meaning in this app and the canvas gets no exemption: four
// families map to the identity colours and ember appears nowhere. Node size
// is distinct-neighbour degree, computed server-side. Money totals on
// selection are summed in code from amounts the server attached — never a
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


// The types whose labels are NAMES. An island titled by its strongest member
// used to surface a whole intention sentence; a title is a handle, not a
// paragraph, so nameable types win even over a higher-degree prose node.
const NAMEABLE = new Set(["project", "person", "merchant", "category", "place"]);

function islandTitle(members) {

  const nameable = members.filter(m => NAMEABLE.has(m.type));

  const pool = nameable.length > 0 ? nameable : members;

  const strongest = pool.reduce((a, b) => ((b.val || 0) > (a.val || 0) ? b : a));

  const title = strongest.label || "";

  return title.length > 26 ? `${title.slice(0, 25)}…` : title;

}


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
// moves. In 3D the same slider scales the sphere's radius instead: one
// control, whatever the shape of the world.
function applySpread(fg, factor) {

  fg.d3Force("charge").strength(-26 * factor * factor);
  fg.d3Force("link").distance(26 * factor);
  fg.d3Force("collide", forceCollide(node => (radiusOf(node) + 3) * (0.7 + 0.5 * factor)));

  // The leash that makes disconnected islands share one world. Without it,
  // components with no edge between them repel each other for as long as the
  // simulation runs. Weak, deliberately: it must gather, not crush.
  fg.d3Force("x", forceX(0).strength(0.05 + 0.02 * factor));
  fg.d3Force("y", forceY(0).strength(0.05 + 0.02 * factor));

}


const SPREAD_MIN = 0.6;
const SPREAD_MAX = 1.8;

// Sphere radius at spread 1, scaled by node count so a graph that doubles
// grows its world instead of crowding it — the "grow with more info" the
// sphere was asked for.
const sphereRadius = (count, factor) => (70 + 9 * Math.sqrt(count)) * factor;


export default function GraphCanvas({ nodes, links, focus = null, failed = false }) {

  const flatRef = useRef(null);
  const roundRef = useRef(null);

  const fgRef = useRef(null);       // the 2D engine
  const fg3Ref = useRef(null);      // the 3D engine, null until first toggle

  const [mode, setMode] = useState("flat");
  const [loading3d, setLoading3d] = useState(false);

  const [selected, setSelected] = useState(null);
  const [hiddenFamilies, setHiddenFamilies] = useState(() => new Set());
  const [spread, setSpread] = useState(1);

  // What the viewport is looking at — the island holding the most on-screen
  // nodes (2D) or the most camera-facing nodes (3D). Lives in the header,
  // never on the canvas.
  const [caption, setCaption] = useState(null);

  // Canvas callbacks fire every frame and close over their creation scope, so
  // everything they need lives in refs the React handlers keep current.
  const selectedRef = useRef(null);
  const neighboursRef = useRef(new Set());
  const hiddenRef = useRef(hiddenFamilies);
  const paletteRef = useRef(null);
  const modeRef = useRef("flat");
  const spreadRef = useRef(1);
  const captionRef = useRef(null);
  const frameRef = useRef(0);

  // Whether the user has taken the camera. Until they touch the canvas, the
  // 2D view re-frames the whole graph every engine tick — so the settle plays
  // out ON SCREEN, framed, instead of half off the edge until a final jump.
  // The first touch ends it: a camera the user is holding must never move
  // itself.
  const cameraOwnedRef = useRef(false);

  // Labels drawn this frame, in graph coordinates. Reset before each frame,
  // checked before every label — the overlap rule that keeps a zoomed-mid
  // view readable. Draw order is by degree (see the sort below), so when two
  // labels want one spot, the more connected thing wins.
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


  // Connected components — the islands. Union-find, so when future data joins
  // two of them, one component with one title simply appears, no code change.
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
      .map(members => ({ title: islandTitle(members), ids: members.map(m => m.id) }));

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


  // Shared by both engines: the gentle landing. No zoom jump — the first
  // version leapt to 2.2× on every tap and the user lost the shape of the
  // graph each time. Zoom only ever nudges IN, never past 1.5, and the node
  // is centred ABOVE the card's space rather than underneath it.
  const settleOn = (fg, node) => {

    const zoom = fg.zoom();
    const target = Math.max(zoom, 1.5);

    if (zoom < 1.5) fg.zoom(1.5, 400);

    const el = flatRef.current;
    const offset = el ? (el.clientHeight * 0.14) / target : 0;

    fg.centerAt(node.x, node.y + offset, 400);

  };


  const clickNode = (node) => {
    cameraOwnedRef.current = true;
    select(node);
    if (modeRef.current === "flat" && fgRef.current) settleOn(fgRef.current, node);
  };


  const updateCaption = (title) => {
    if (title !== captionRef.current) {
      captionRef.current = title;
      setCaption(title);
    }
  };


  // ── The flat engine ──────────────────────────────────────────────────────

  useEffect(() => {

    const el = flatRef.current;

    if (!el || nodes.length === 0) return;

    let disposed = false;
    let fg = null;
    let observer = null;

    paletteRef.current = readPalette();

    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { paletteRef.current = readPalette(); };
    scheme.addEventListener("change", onScheme);

    const takeCamera = () => { cameraOwnedRef.current = true; };
    el.addEventListener("pointerdown", takeCamera, { capture: true });

    // Sorted by degree, descending, ONCE — this is draw order, and draw order
    // is label priority.
    const liveNodes = nodes.map(n => ({ ...n })).sort((a, b) => (b.val || 0) - (a.val || 0));
    const liveById = new Map(liveNodes.map(n => [n.id, n]));

    const liveComponents = components.map(c => ({
      title: c.title,
      members: c.ids.map(id => liveById.get(id)).filter(Boolean)
    }));

    // The library touches window at import time — a static import would put
    // it in the server bundle and kill the page at build.
    import("force-graph").then(({ default: ForceGraph }) => {

      if (disposed) return;

      const still = reducedMotion();

      // Which island dominates the viewport right now. Called from the
      // render loop (throttled) AND once after the engine stops — rendering
      // pauses when the physics does, so a caption computed only per-frame
      // would freeze stale, or never appear at all on a page that settled in
      // a background tab.
      const computeCaption = () => {

        const topLeft = fg.screen2GraphCoords(0, 0);
        const bottomRight = fg.screen2GraphCoords(el.clientWidth, el.clientHeight);

        let best = null;
        let bestCount = 0;

        for (const component of liveComponents) {

          let visible = 0;

          for (const m of component.members) {
            if (hiddenRef.current.has(FAMILY[m.type] || "notes")) continue;
            if (m.x >= topLeft.x && m.x <= bottomRight.x &&
                m.y >= topLeft.y && m.y <= bottomRight.y) visible += 1;
          }

          if (visible > bestCount) {
            bestCount = visible;
            best = component;
          }

        }

        updateCaption(bestCount >= 3 ? best.title : null);

      };

      const isDim = (node) =>
        (selectedRef.current &&
          node.id !== selectedRef.current &&
          !neighboursRef.current.has(node.id));

      fg = new ForceGraph(el)
        .graphData({ nodes: liveNodes, links: links.map(l => ({ ...l })) })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")

        .minZoom(0.3)
        .maxZoom(10)

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

          // A charge's label is its merchant's name — which the merchant node
          // next to it already says. Eight dots all captioned "Fenwick
          // Market" is noise wearing a label, so a charge speaks its AMOUNT,
          // the one thing that distinguishes it, and only at a much closer
          // zoom than named things.
          const isCharge = node.type === "transaction";

          const text = isCharge && node.extra != null
            ? `$${Math.abs(Number(node.extra)).toFixed(0)}`
            : node.label;

          // Labels arrive with zoom, biggest first — scale × √degree crosses
          // the threshold earlier for a hub than a leaf, so names appear a
          // few at a time instead of forty at once...
          const wants =
            isSelected || isNeighbour ||
            scale * Math.sqrt(node.val || 1) > (isCharge ? 6 : 3.2);

          if (wants && !dimmed) {

            const size = Math.max(11 / scale, 1.6);

            ctx.font = `${size}px "DM Mono", ui-monospace, monospace`;

            // ...and the ones that do arrive are not allowed to land on each
            // other. A label that would overlap one already drawn this frame
            // is skipped (the selection always speaks).
            const width = ctx.measureText(text).width;
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
              ctx.strokeText(text, node.x, rect.y);
              ctx.fillStyle = isSelected ? palette.ink : palette.inkSoft;
              ctx.fillText(text, node.x, rect.y);

            }

          }

          ctx.globalAlpha = 1;

        })

        // Nothing is DRAWN after the frame any more — island titles moved off
        // the canvas entirely after they clogged the overview (a title could
        // be a whole intention sentence, and several landed on the graph at
        // once). This hook now only works out which island dominates the
        // viewport, and the header caption says it.
        .onRenderFramePost(() => {
          frameRef.current += 1;
          if (frameRef.current % 15 === 0) computeCaption();
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

        .onNodeClick(clickNode)
        .onBackgroundClick(() => select(null))

        // The camera never trusts the physics. Until the user takes over, the
        // whole graph is re-framed every tick — the settle happens on screen,
        // framed, instead of drifting half off a phone edge.
        .onEngineTick(() => {
          if (!cameraOwnedRef.current) fg.zoomToFit(0, 60);
        })

        .onEngineStop(() => {

          // A deep link from a project, person or insight card lands centred
          // and selected on that thing.
          const target = focus && fg.graphData().nodes.find(n => n.id === focus);

          if (target && !cameraOwnedRef.current) {
            cameraOwnedRef.current = true;
            select(target);
            settleOn(fg, target);
            return;
          }

          // One last authoritative fit. The per-tick refit depends on ticks
          // actually happening, and cooldownTime is wall-clock — a tab that
          // loads in the background has its animation frames paused while
          // the clock runs, so the engine can stop having barely ticked.
          if (!cameraOwnedRef.current) fg.zoomToFit(400, 60);

          // After the fit transition lands, say what we're looking at.
          setTimeout(computeCaption, 500);

        });

      applySpread(fg, spreadRef.current);

      fg.zoomToFit(0, 60);

      fgRef.current = fg;

      observer = new ResizeObserver(() => {
        fg.width(el.clientWidth);
        fg.height(el.clientHeight);
        fg3Ref.current?.width(el.clientWidth);
        fg3Ref.current?.height(el.clientHeight);
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
      fg3Ref.current?._destructor();
      fg3Ref.current = null;
    };

    // The graph itself is load-time data; selection, filters, spread and mode
    // act through refs so the engine (and its settled layout) is never
    // rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, focus]);


  // ── The sphere ───────────────────────────────────────────────────────────
  //
  // Asked for twice, which is a decision. Built as an experiment with the
  // cost fenced: three.js and 3d-force-graph load on the FIRST toggle only —
  // the everyday 2D page never ships them — and everything shared (selection,
  // filters, the card, the caption) runs through the same refs, so the two
  // views cannot disagree about state.
  //
  // The layout is a real force simulation projected onto a sphere's surface
  // every tick: clusters still form and hubs still gather their neighbours,
  // but the world is a closed surface — there is no expanseless plane to get
  // lost in, which was the original argument for it. It spins slowly on its
  // own until first touch (orbit controls take over), and the header caption
  // names the hemisphere facing the camera.

  const enterSphere = async () => {

    modeRef.current = "round";
    setMode("round");

    if (fg3Ref.current) {
      fgRef.current?.pauseAnimation();
      fg3Ref.current.resumeAnimation();
      return;
    }

    setLoading3d(true);

    try {

      // three.js rides in with it — imported here, not at module scope, for
      // the same bundle reason. It is only needed for fog and lighting.
      const [{ default: ForceGraph3D }, THREE] = await Promise.all([
        import("3d-force-graph"),
        import("three")
      ]);

      const el = roundRef.current;

      if (!el || modeRef.current !== "round") { setLoading3d(false); return; }

      const palette = paletteRef.current || readPalette();

      const liveNodes = nodes.map(n => ({ ...n }));
      const liveById = new Map(liveNodes.map(n => [n.id, n]));

      const liveComponents = components.map(c => ({
        title: c.title,
        members: c.ids.map(id => liveById.get(id)).filter(Boolean)
      }));

      // Trackball, not orbit. Orbit controls clamp at the poles by design —
      // spin the globe upward far enough and it hits a wall, which on a
      // sphere reads as broken. Trackball tumbles freely in every direction;
      // a globe has no up.
      const fg3 = new ForceGraph3D(el, { controlType: "trackball" })
        .graphData({ nodes: liveNodes, links: links.map(l => ({ ...l })) })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)

        .nodeVal(n => n.val || 1)
        // 8 segments reads as a golf ball once the dots have any size.
        .nodeResolution(16)
        .nodeOpacity(1)
        .nodeLabel(() => "")
        .nodeColor(n => {
          const sel = selectedRef.current;
          if (sel && (n.id === sel || neighboursRef.current.has(n.id))) return palette.moss;
          return paletteRef.current.family[FAMILY[n.type] || "notes"];
        })

        .linkColor(l => {
          const sel = selectedRef.current;
          const a = l.source.id ?? l.source;
          const b = l.target.id ?? l.target;
          return sel && (a === sel || b === sel) ? palette.moss : palette.line;
        })
        .linkOpacity(0.35)

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
        })
        .onBackgroundClick(() => select(null))

        // The projection that makes it a sphere: after the forces move the
        // nodes, each is pulled onto the surface of radius R. Clusters keep
        // clustering — they just do it on a globe.
        .onEngineTick(() => {

          const R = sphereRadius(liveNodes.length, spreadRef.current);

          for (const node of liveNodes) {
            const length = Math.hypot(node.x || 0, node.y || 0, node.z || 0) || 1;
            const scale = R / length;
            node.x *= scale;
            node.y *= scale;
            node.z *= scale;
          }

        });

      const R = sphereRadius(liveNodes.length, spreadRef.current);

      fg3.cameraPosition({ x: 0, y: 0, z: R * 3.1 });

      // A still sphere had no depth: the far side drew exactly like the near
      // side and the picture read as a flat tangle. Fog is the cue — nodes
      // and links fade toward the page colour with distance from the camera,
      // so the back of the globe recedes instead of competing. Distances are
      // camera-relative, which means zooming IN pulls things out of the haze
      // for free. Re-tuned whenever the spread slider resizes the world.
      const setFog = () => {
        const radius = sphereRadius(liveNodes.length, spreadRef.current);
        fg3.scene().fog = new THREE.Fog(paletteRef.current.paper, radius * 2.1, radius * 4.9);
      };

      setFog();

      fg3._setFog = setFog;

      // The default scene lights a sphere like a rendered marble — a hot spot
      // up-left, a dark limb — which against this design system's flat
      // colour reads as clip-art. Pure ambient light makes every dot a flat
      // disc of its family colour, the same vocabulary as the 2D canvas, and
      // leaves fog as the only depth cue. (Traversal instead of .lights():
      // resilient to however the library arranges its defaults.)
      const strays = [];
      fg3.scene().traverse(o => { if (o.isLight) strays.push(o); });
      for (const light of strays) light.parent?.remove(light);
      fg3.scene().add(new THREE.AmbientLight(0xffffff, Math.PI));

      // Ambient spin, by rotating the SCENE rather than driving the camera —
      // the camera belongs to the trackball controls, and two owners of one
      // camera is a fight the user loses. Stops at first touch, forever.
      const spinning = { on: true };

      const spinTimer = setInterval(() => {
        if (spinning.on && modeRef.current === "round") {
          fg3.scene().rotation.y += 0.0022;
        }
      }, 16);

      el.addEventListener("pointerdown", () => { spinning.on = false; }, { capture: true, once: true });

      // Which hemisphere is facing the camera — the caption's 3D answer.
      // The camera lives in world space but the nodes live in the rotated
      // scene, so the camera is rotated BACK into graph space before the
      // dot product, or the caption would drift wrong as the globe spins.
      const captionTimer = setInterval(() => {

        if (modeRef.current !== "round") return;

        const cam = fg3.cameraPosition();
        const spin = fg3.scene().rotation.y;

        const cx = cam.x * Math.cos(-spin) - cam.z * Math.sin(-spin);
        const cz = cam.x * Math.sin(-spin) + cam.z * Math.cos(-spin);

        const camLength = Math.hypot(cx, cam.y, cz) || 1;

        let best = null;
        let bestCount = 0;

        for (const component of liveComponents) {

          let facing = 0;

          for (const m of component.members) {
            if (hiddenRef.current.has(FAMILY[m.type] || "notes")) continue;
            const dot = ((m.x || 0) * cx + (m.y || 0) * cam.y + (m.z || 0) * cz) / camLength;
            if (dot > 0) facing += 1;
          }

          if (facing > bestCount) {
            bestCount = facing;
            best = component;
          }

        }

        updateCaption(bestCount >= 3 ? best.title : null);

      }, 600);

      const originalDestructor = fg3._destructor.bind(fg3);
      fg3._destructor = () => {
        clearInterval(captionTimer);
        clearInterval(spinTimer);
        originalDestructor();
      };

      fg3Ref.current = fg3;
      fgRef.current?.pauseAnimation();

    } catch (error) {

      // The sphere failing to load must cost nothing but the tap: back to
      // flat, no error screen over a working graph. But the reason goes to
      // the console — this catch once swallowed a real setup bug and made a
      // broken sphere indistinguishable from a slow network.
      console.error("SPHERE FAILED:", error);

      modeRef.current = "flat";
      setMode("flat");

    } finally {
      setLoading3d(false);
    }

  };


  const enterFlat = () => {
    modeRef.current = "flat";
    setMode("flat");
    fg3Ref.current?.pauseAnimation();
    fgRef.current?.resumeAnimation();
  };


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
    spreadRef.current = value;

    // Flat: the forces re-settle at the new scale. Round: the projection
    // radius changes and the next ticks carry every node to the new surface.
    // Same slider, same meaning — how big is the world.
    if (fgRef.current) {
      applySpread(fgRef.current, value);
      fgRef.current.d3ReheatSimulation();
    }

    if (fg3Ref.current) {
      fg3Ref.current._setFog?.();
      fg3Ref.current.d3ReheatSimulation();
    }

  };


  const recentre = () => {
    if (modeRef.current === "round" && fg3Ref.current) {
      const R = sphereRadius(nodes.length, spreadRef.current);
      fg3Ref.current.cameraPosition({ x: 0, y: 0, z: R * 3.1 }, { x: 0, y: 0, z: 0 }, 600);
      return;
    }
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
  // amounts already on the transaction nodes.
  const money = useMemo(
    () => moneyTotal(neighbourRows.map(row => row.node)),
    [neighbourRows]
  );


  const walkTo = (node) => {

    const engine = modeRef.current === "round" ? fg3Ref.current : fgRef.current;
    const live = engine?.graphData().nodes.find(n => n.id === node.id);

    if (!live) return;

    cameraOwnedRef.current = true;
    select(live);

    if (modeRef.current === "flat") settleOn(fgRef.current, live);

  };


  if (failed) {
    return (
      <div className="pos-frame-fixed fixed inset-0 grid place-items-center bg-paper px-8">
        <p className="max-w-[26rem] text-center text-[0.9rem] leading-relaxed text-ink-soft">
          The graph couldn’t load just now — the connections are there, the page
          failed to fetch them. Pull to refresh, or try again in a moment.
        </p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="pos-frame-fixed fixed inset-0 grid place-items-center bg-paper px-8">
        <p className="max-w-[26rem] text-center text-[0.9rem] leading-relaxed text-ink-soft">
          Nothing is connected yet. The graph is built each night from what you
          capture — a note that names a person, a charge at a shop you know.
          Once the links exist, this page becomes them.
        </p>
      </div>
    );
  }


  return (
    <div className="pos-frame-fixed fixed inset-0 bg-paper">

      <div ref={flatRef} className={`absolute inset-0 ${mode === "flat" ? "" : "invisible"}`} />
      <div ref={roundRef} className={`absolute inset-0 ${mode === "round" ? "" : "invisible"}`} />

      <header className="pointer-events-none absolute left-5 top-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="pos-display text-[1.35rem] text-ink">Connections</h1>
        <p className="pos-data mt-0.5 text-[0.7rem] text-ink-soft">
          {nodes.length} things · {links.length} links
        </p>
        {/* What the viewport is looking at. This line is the island title's
            whole UI — the canvas never says it, so it can never collide with
            the graph. */}
        {caption && (
          <p className="pos-data mt-0.5 text-[0.72rem] text-moss" aria-live="polite">
            ◉ {caption}
          </p>
        )}
      </header>

      <div className="absolute inset-x-0 top-[max(5.25rem,calc(env(safe-area-inset-top)+4.25rem))] flex flex-wrap justify-center gap-1.5 px-4">
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
            onClick={mode === "flat" ? enterSphere : enterFlat}
            disabled={loading3d}
            aria-label={mode === "flat" ? "View as a sphere" : "View flat"}
            className="pos-data grid h-10 w-10 place-items-center rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 text-[0.68rem] text-ink-soft shadow-lift backdrop-blur-xl hover:text-ink disabled:opacity-45"
          >
            {loading3d ? "…" : mode === "flat" ? "3D" : "2D"}
          </button>

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

          {/* The "grow the world" control: one slider, one meaning — how big
              is the world. Flat, it re-settles the forces; round, it grows
              the sphere. */}
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

      {/* Compact on purpose — the first version took 42% of the screen and
          hid the graph it was describing. A quarter, scrollable inside. */}
      {selected && (
        <div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] mx-auto max-w-[26rem]">
          <div className="max-h-[26vh] overflow-y-auto rounded-card bg-card/95 p-3 shadow-lift backdrop-blur-xl">

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="pos-data text-[0.62rem] uppercase tracking-[0.12em] text-ink-soft">
                  {typeName(selected.type)}
                  {detail(selected) && ` · ${detail(selected)}`}
                  {` · ${selected.val || 0} connection${(selected.val || 0) === 1 ? "" : "s"}`}
                  {money.count > 0 &&
                    ` · $${money.total.toFixed(2)} in ${money.count} charge${money.count === 1 ? "" : "s"}`}
                </p>
                <h2 className="mt-0.5 truncate text-[0.9rem] leading-snug text-ink">{selected.label}</h2>
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
              <ul className="mt-2 space-y-0 border-t border-[var(--line)] pt-1.5">
                {neighbourRows.map(({ node, relation, direction }) => (
                  <li key={node.id}>
                    <button
                      onClick={() => walkTo(node)}
                      className="flex w-full items-baseline justify-between gap-2 rounded-item px-2 py-1 text-left transition-colors hover:bg-[var(--sunken)]"
                    >
                      <span className="min-w-0 truncate text-[0.82rem] text-ink">{node.label}</span>
                      <span className="pos-data shrink-0 text-[0.62rem] text-ink-soft">
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
