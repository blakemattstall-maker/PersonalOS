// Where the dots go.
//
// Separated from the component on purpose. This is pure geometry — data in,
// coordinates out, no React, no DOM — and keeping it that way means the
// arrangement can be checked directly rather than inferred from a screenshot.
// A diagram whose only test is "it looked fine at desktop width" is a diagram
// that collides on a phone, which is the mistake /welcome's SceneGraph had to
// solve by hand-placing fifteen labels against a metrics checker.
//
// ── Why this is not a force simulation ───────────────────────────────────
//
// A force layout answers "thousands of nodes, no natural arrangement". This has
// at most sixty and a completely natural arrangement: one centre, neighbours
// grouped by which table they came from. Simulating it would scatter those
// groups into a lumpy, non-reproducible ring and destroy the single most
// informative thing on the screen — that one project reaches into four
// different tables. It also could not be server-rendered, and could not read
// the CSS variables the design system runs on.
//
// Deterministic: same data, same picture, on the server and in the browser.


export const VIEW = 380;
export const CENTRE = VIEW / 2;

export const R_BASE = 86;
export const RING_STEP = 25;

// Second-hop nodes sit further out than anything at one hop, always — including
// further out than a first-hop node pushed onto the outer ring by a crowded
// sector. Otherwise "further away" and "there were a lot of these" look
// identical, and only one of them is true.
export const R_DISTANT = R_BASE + RING_STEP * 2 + 14;

export const R_ARC = R_BASE - 14;
export const R_LABEL = R_BASE + RING_STEP * 2 + 30;

// Half the width of the widest label this can produce, in viewBox units.
//
// Sector labels are centred on a radial point, which puts a label due left at
// x = 24 — and "2 deep thoughts" is about 84 units wide in DM Mono at 9.5px
// (0.59em advance, measured off the render), so 42 units of it hang off the
// canvas. It shipped in the first render as "eep thoughts".
//
// Clamping the anchor rather than shrinking the radius, because the radius is
// what keeps labels clear of the outer ring of dots. A label pulled slightly
// off its exact radial line is still obviously the label for that arc; a label
// with its first word cut off is not a label.
export const LABEL_MARGIN = 48;

const clamp = (n, low, high) => Math.min(Math.max(n, low), high);

// How much bigger the space BETWEEN groups is than the space within one.
//
// This is the number the whole diagram lives or dies on, and the first version
// got it backwards. A fixed 0.16 rad gap sounds generous until you count: 23
// nodes with 12 of them tasks put the within-group spacing at 0.27 rad, so the
// separator was smaller than the thing it was separating and the ring read as
// one unbroken circle. Every group boundary was invisible and the diagram's
// only claim — these came from different tables — was not being made.
//
// Expressed as a ratio rather than an angle so it cannot go stale: whatever the
// node count, a gap is always twice the step, and the grouping is always
// legible. Solving 2π = step·(N − G) + G·(RATIO·step) gives the step below.
export const GAP_RATIO = 2;

// Below this arc distance between neighbouring dots, alternate two rings.
// Measured in viewBox units at R_BASE rather than as a node count, because the
// thing that actually makes dots collide is spacing, not population.
export const MIN_DOT_GAP = 14;


// Rounded before it reaches an attribute. Math.cos and Math.sin are not
// required to be correctly rounded, so Node and the browser disagree in the
// last bits and every node hydrates as a mismatch — trap #12d, which both
// /welcome scenes already guard against exactly this way.
export const round = (n) => Number(n.toFixed(2));


export function arcPath(from, to, radius) {

  const x1 = round(CENTRE + Math.cos(from) * radius);
  const y1 = round(CENTRE + Math.sin(from) * radius);
  const x2 = round(CENTRE + Math.cos(to) * radius);
  const y2 = round(CENTRE + Math.sin(to) * radius);

  const large = to - from > Math.PI ? 1 : 0;

  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;

}


// Grouped by type, each group given a slice of the circle proportional to its
// size, with a faint arc drawn behind it.
//
// The arc is what makes the grouping visible. Colour would be the obvious way
// and is not available: this design system spends colour on meaning — ember is
// reserved for "waiting on you" and nothing else may use it — and fourteen
// entity types would need fourteen hues that mean nothing. Position, an arc and
// a count carry the same information and cost no palette.
export function layout(nodes) {

  if (!nodes?.length) return { placed: [], sectors: [] };

  const groups = new Map();

  // walk() returns nodes already sorted by distance, then confidence, then
  // recency. Preserving that order within a group means the first dot in a
  // sector is the strongest connection in it.
  for (const node of nodes) {
    if (!groups.has(node.type)) groups.set(node.type, []);
    groups.get(node.type).push(node);
  }

  const entries = [...groups.entries()];

  // Every dot gets the same angular step wherever it sits, and every boundary
  // gets GAP_RATIO times that. Derived from the totals rather than assigned per
  // group, which is what guarantees the gaps are always the widest spaces on
  // the circle and the whole thing still closes at exactly 2π.
  const step = (Math.PI * 2) / (nodes.length + entries.length * (GAP_RATIO - 1) + entries.length);

  const gap = step * GAP_RATIO;

  // Dots pack tighter as the neighbourhood grows, and past a point they touch.
  // Two rings, alternating, doubles the effective separation.
  const crowded = R_BASE * step < MIN_DOT_GAP;

  const placed = [];
  const sectors = [];

  let cursor = -Math.PI / 2;

  for (const [type, members] of entries) {

    const span = (members.length - 1) * step;

    members.forEach((node, index) => {

      const angle = cursor + index * step;

      const ring = crowded ? index % 2 : 0;

      const radius = node.distance > 1 ? R_DISTANT : R_BASE + ring * RING_STEP;

      placed.push({
        ...node,
        key: `${node.type}:${node.id}`,
        x: round(CENTRE + Math.cos(angle) * radius),
        y: round(CENTRE + Math.sin(angle) * radius)
      });

    });

    const mid = cursor + span / 2;

    sectors.push({
      type,
      count: members.length,
      // Extended half a step past the outermost dot at each end, so a group of
      // one still gets a visible arc rather than a zero-length path, and so
      // every arc reads as a container rather than as a line between two dots.
      //
      // Drawn inside the dots, so a dot always sits outside its own arc rather
      // than being cut in half by it.
      path: arcPath(cursor - step / 2, cursor + span + step / 2, R_ARC),
      labelX: round(clamp(CENTRE + Math.cos(mid) * R_LABEL, LABEL_MARGIN, VIEW - LABEL_MARGIN)),
      labelY: round(clamp(CENTRE + Math.sin(mid) * R_LABEL, 10, VIEW - 6))
    });

    cursor += span + gap;

  }

  return { placed, sectors };

}
