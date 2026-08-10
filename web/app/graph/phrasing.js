// Turning an edge into a sentence.
//
// Pure, and separate from the component for the same reason the geometry is:
// this produces a CLAIM about someone's life — "Northline Supply is mentioned
// by this note" — and a claim that can only be checked by looking at a
// screenshot is a claim nothing is checking. It shipped wrong once already.


export const TYPE_LABEL = {
  memory: ["memory", "memories"],
  note: ["note", "notes"],
  intention: ["intention", "intentions"],
  task: ["task", "tasks"],
  event: ["event", "events"],
  project: ["project", "projects"],
  person: ["person", "people"],
  place: ["place", "places"],
  transaction: ["charge", "charges"],
  deep_thought: ["deep thought", "deep thoughts"],
  news_item: ["story", "stories"],
  nudge: ["nudge", "nudges"],
  merchant: ["merchant", "merchants"],
  category: ["category", "categories"]
};


export function typeName(type, count = 1) {
  const pair = TYPE_LABEL[type] || [type, `${type}s`];
  return count === 1 ? pair[0] : pair[1];
}


// Both readings of every relation. `out` is the sentence in the direction the
// edge was stored (from → to); `in` is the same fact said the other way round.
export const RELATION_LABEL = {
  mentions: { out: "mentions", in: "mentioned by" },
  belongs_to: { out: "belongs to", in: "contains" },
  spent_on: { out: "spent on", in: "paid for by" },
  paid_to: { out: "paid to", in: "charged" },
  categorised_as: { out: "categorised as", in: "includes" },
  located_at: { out: "at", in: "hosted" }
};


// An edge is read in two different directions on this page, and using one
// string for both is a false sentence about a true edge.
//
// The list rows put the neighbour first — "Rewrite the positioning page ·
// belongs to" — meaning the node's relationship TO the root. The caption puts
// the root first — "Northline Supply · mentioned by · [the note]" — which is
// the opposite. Sharing one function shipped a caption claiming "Northline
// Supply mentions [the note]" when it is the note that mentions the merchant.
//
// walk() sets `direction` to record which end the stored edge started at:
// "out" means it already points root → node, "in" means it points node → root.

function phrase(node, flip) {

  const pair = RELATION_LABEL[node.relation];

  // An unknown relation is rendered as itself rather than guessed at. It reads
  // a little mechanically in one direction, which is the correct trade against
  // inventing an inverse for a relation this file has never seen.
  if (!pair) return node.relation?.replace(/_/g, " ") || "linked to";

  return (node.direction === "out") === flip ? pair.in : pair.out;

}


// "[node] <phrase> [root]" — used by the list rows.
export function nodeToRoot(node) {
  return phrase(node, true);
}


// "[root] <phrase> [node]" — used by the caption.
export function rootToNode(node) {
  return phrase(node, false);
}


export function shorten(text, max = 46) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}


// What a selection's neighbourhood costs.
//
// Summed here, in code, from the amounts the server already attached to each
// transaction node — never asked of a model, never re-derived from a second
// source. Absolute values, because this answers "how much money moved through
// this thing", and a refund making a project look cheaper than it was is the
// kind of flattering arithmetic this system refuses everywhere else.
//
// Only direct transaction neighbours count. A category's total is the charges
// IN it, a merchant's is the charges AT it, a project's is the charges spent
// ON it — all of which are exactly the transaction nodes one hop away.
export function moneyTotal(nodes) {

  const charges = (nodes || []).filter(n => n?.type === "transaction" && n.extra != null);

  return {
    count: charges.length,
    total: charges.reduce((sum, n) => sum + Math.abs(Number(n.extra) || 0), 0)
  };

}


// A charge is not worth reading without its amount, and a merchant is not worth
// reading without how many times it appears. Both arrive in `extra`.
export function detail(node) {

  if (node.type === "transaction" && node.extra != null) {
    return `$${Math.abs(Number(node.extra)).toFixed(2)}`;
  }

  if ((node.type === "merchant" || node.type === "category") && node.extra != null) {
    return `${node.extra} charge${Number(node.extra) === 1 ? "" : "s"}`;
  }

  return null;

}
