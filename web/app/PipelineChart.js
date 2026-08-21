import { STAGES } from "../lib/pipeline.js";


// A Sankey, drawn by hand.
//
// No chart library: the CSP on this app forbids third-party script, and every
// library that draws one of these is heavier than the two hundred lines it
// takes to do properly. Server-rendered SVG also means the chart is in the
// HTML — readable, printable, and present before any JavaScript runs.
//
// The rules that make a Sankey honest, and which a bar chart would let you
// dodge: a node's height is its count, a flow's thickness is its count, and
// what leaves a node equals what entered it. Nothing here is scaled to look
// better.


const WIDTH = 720;
const NODE_W = 13;
const GAP = 10;          // vertical space between stacked nodes
const PAD = 4;

// Colour carries meaning in this app, so the chart uses the same vocabulary
// the rest of it does rather than inventing a palette.
const TONE = {
  neutral: "var(--tide, #4a6b8a)",
  good:    "var(--moss, #4a6b62)",
  great:   "var(--ember, #e07038)",
  bad:     "var(--ink-soft, #5e6a70)",
  muted:   "var(--line, #b9c0bf)"
};


// A flow is drawn as a ribbon: two cubic curves, out and back. The control
// points sit halfway between the columns, which is what gives a Sankey its
// characteristic slack rather than a straight diagonal.
function ribbon(x0, y0, x1, y1, thickness) {

  const mid = (x0 + x1) / 2;

  const t = Math.max(thickness, 1);

  return [
    `M ${x0} ${y0}`,
    `C ${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`,
    `L ${x1} ${y1 + t}`,
    `C ${mid} ${y1 + t}, ${mid} ${y0 + t}, ${x0} ${y0 + t}`,
    "Z"
  ].join(" ");

}


export default function PipelineChart({ nodes, flows }) {

  if (!nodes?.length) return null;

  const columns = [...new Set(nodes.map(n => n.column))].sort((a, b) => a - b);

  // Height comes from the busiest column, so the tallest stack fits exactly
  // and every other column is drawn to the same scale.
  const columnTotals = columns.map(c =>
    nodes.filter(n => n.column === c).reduce((sum, n) => sum + n.count, 0)
  );

  const busiest = Math.max(...columnTotals);

  const tallestStack = Math.max(...columns.map(c => nodes.filter(n => n.column === c).length));

  const HEIGHT = 340;

  const usable = HEIGHT - (tallestStack - 1) * GAP - PAD * 2;

  const scale = usable / busiest;

  // Lay every node out first: x by column, y by stacking within it.
  const placed = new Map();

  const columnX = (c) => {
    if (columns.length === 1) return PAD;
    const span = WIDTH - NODE_W - PAD * 2;
    return PAD + (columns.indexOf(c) / (columns.length - 1)) * span;
  };

  for (const c of columns) {

    const inColumn = nodes.filter(n => n.column === c);

    const stackHeight = inColumn.reduce((sum, n) => sum + n.count * scale, 0) + (inColumn.length - 1) * GAP;

    let y = PAD + (HEIGHT - PAD * 2 - stackHeight) / 2;

    for (const node of inColumn) {
      const h = Math.max(node.count * scale, 2);
      placed.set(node.stage, { ...node, x: columnX(c), y, h });
      y += h + GAP;
    }

  }

  // Then thread the flows through, consuming each node's edge from the top
  // down so ribbons never overlap at their anchor.
  const outCursor = new Map();
  const inCursor = new Map();

  const drawn = [];

  for (const flow of flows) {

    const from = placed.get(flow.from);
    const to = placed.get(flow.to);

    if (!from || !to) continue;

    const t = Math.max(flow.count * scale, 1);

    const y0 = from.y + (outCursor.get(flow.from) || 0);
    const y1 = to.y + (inCursor.get(flow.to) || 0);

    outCursor.set(flow.from, (outCursor.get(flow.from) || 0) + t);
    inCursor.set(flow.to, (inCursor.get(flow.to) || 0) + t);

    drawn.push({
      d: ribbon(from.x + NODE_W, y0, to.x, y1, t),
      tone: TONE[to.tone] || TONE.muted,
      key: `${flow.from}-${flow.to}`,
      title: `${from.label} → ${to.label}: ${flow.count}`
    });

  }

  const list = [...placed.values()];

  return (
    <div className="-mx-1 overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label={`Application pipeline: ${list.map(n => `${n.label} ${n.count}`).join(", ")}`}
      >

        {/* Ribbons under the nodes, so a node's block always reads as solid. */}
        <g opacity="0.42">
          {drawn.map(f => (
            <path key={f.key} d={f.d} fill={f.tone}>
              <title>{f.title}</title>
            </path>
          ))}
        </g>

        {list.map(n => (
          <g key={n.stage}>
            <rect
              x={n.x}
              y={n.y}
              width={NODE_W}
              height={n.h}
              rx="2.5"
              fill={TONE[n.tone] || TONE.muted}
            >
              <title>{`${n.label}: ${n.count}`}</title>
            </rect>
            {/* The label sits inside the chart on the last column and outside
                everywhere else, so nothing runs off the right edge. */}
            <text
              x={n.column === Math.max(...columns) ? n.x - 6 : n.x + NODE_W + 6}
              y={n.y + Math.max(n.h / 2, 6)}
              dominantBaseline="middle"
              textAnchor={n.column === Math.max(...columns) ? "end" : "start"}
              className="fill-[var(--ink)]"
              style={{ fontSize: "11.5px", fontWeight: 500 }}
            >
              {n.label}: {n.count}
            </text>
          </g>
        ))}

      </svg>
    </div>
  );

}
