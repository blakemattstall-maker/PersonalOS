// The shape of a job search, computed from what actually happened.
//
// The chart this exists to draw is a Sankey: applications fanning out into
// rejections, silence, and the few that went somewhere. Its whole value is
// honesty about proportion — 196 applications producing one offer is a fact
// worth looking at, and no summary sentence lands the way that picture does.
//
// Everything here is pure. Given the events, it returns the nodes and flows;
// it never queries and never renders, so the arithmetic can be tested against
// fixtures and the same numbers feed the page, the digest and the brief.


// The stages an application can be in, in the order they happen. Order is
// load-bearing: it decides the column each node sits in.
export const STAGES = {
  applied:      { label: "Applied",       column: 0, tone: "neutral" },
  first_round:  { label: "First Round",   column: 1, tone: "good" },
  second_round: { label: "Second Round",  column: 2, tone: "good" },
  final_round:  { label: "Final Round",   column: 3, tone: "good" },
  offer:        { label: "Offer",         column: 4, tone: "great" },
  rejected:     { label: "Rejected",      column: 5, tone: "bad" },
  ghosted:      { label: "No Response",   column: 5, tone: "muted" },
  withdrawn:    { label: "I Withdrew",    column: 5, tone: "muted" }
};

export const ADVANCING = ["first_round", "second_round", "final_round", "offer"];

export const TERMINAL = ["rejected", "ghosted", "withdrawn", "offer"];


// How long an application sits in silence before it is honestly called
// silence. Three weeks is long enough that a reply is unlikely and short
// enough that the picture is not mostly "pending" forever.
export const GHOST_AFTER_DAYS = 21;


// One application's story, from its events.
//
// `events` are that posting's rows, any order. Returns the path it took, which
// is what a flow chart is built from — not just where it ended up.
export function pathFor(events, { now = Date.now() } = {}) {

  const ordered = [...(events || [])]
    .filter(e => e && STAGES[e.stage])
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  if (ordered.length === 0) return { path: [], current: null, silentDays: null };

  const path = [];

  for (const event of ordered) {
    // A stage repeated back-to-back is an edit, not a transition, and would
    // otherwise draw a loop from a node to itself.
    if (path[path.length - 1] !== event.stage) path.push(event.stage);
  }

  const last = ordered[ordered.length - 1];

  const silentDays = Math.floor((now - new Date(last.occurred_at).getTime()) / 86400000);

  const current = path[path.length - 1];

  // Silence is derived, never recorded. An application still sitting at
  // "applied" three weeks on has been ghosted whether or not anyone says so —
  // and the moment a reply arrives, a real event overwrites this.
  if (!TERMINAL.includes(current) && silentDays >= GHOST_AFTER_DAYS) {
    return { path: [...path, "ghosted"], current: "ghosted", silentDays, derived: true };
  }

  return { path, current, silentDays, derived: false };

}


// The whole picture: every node with its total, and every flow between them.
//
// `byPosting` is a Map of posting_id -> events[].
export function buildPipeline(byPosting, { now = Date.now() } = {}) {

  const nodeTotals = new Map();
  const flowTotals = new Map();

  let applications = 0;

  for (const events of byPosting.values()) {

    const { path } = pathFor(events, { now });

    if (path.length === 0) continue;

    applications += 1;

    for (const stage of path) {
      nodeTotals.set(stage, (nodeTotals.get(stage) || 0) + 1);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const key = `${path[i]}→${path[i + 1]}`;
      flowTotals.set(key, (flowTotals.get(key) || 0) + 1);
    }

  }

  const nodes = [...nodeTotals.entries()]
    .map(([stage, count]) => ({
      stage,
      count,
      label: STAGES[stage].label,
      column: STAGES[stage].column,
      tone: STAGES[stage].tone
    }))
    .sort((a, b) => a.column - b.column || b.count - a.count);

  const flows = [...flowTotals.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split("→");
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count);

  return { applications, nodes, flows };

}


// The two numbers worth stating in words, computed here so the page, the
// digest and the brief can never disagree about them.
export function pipelineSummary({ applications, nodes, flows }) {

  const count = (stage) => nodes.find(n => n.stage === stage)?.count || 0;

  const advanced = ADVANCING.reduce((sum, s) => sum + count(s), 0);

  // Of everything that has actually resolved, how much went somewhere. A rate
  // over "all applications" would punish him for the ones still pending.
  const resolved = count("rejected") + count("ghosted") + count("withdrawn") + count("offer");

  return {
    applications,
    advanced,
    offers: count("offer"),
    rejected: count("rejected"),
    ghosted: count("ghosted"),
    pending: applications - resolved,
    // Null rather than zero when nothing has resolved: a rate computed from
    // no data is not a rate.
    responseRate: applications > 0 ? Math.round((advanced / applications) * 100) : null
  };

}
