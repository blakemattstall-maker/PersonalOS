// Local design fixtures. Never reachable in production.
//
// `web/` holds BACKEND_KEY server-side and the backend's API_SECRET is live, so
// a local dev server has no way to fetch real data — every page renders its
// empty state, which is exactly the case a design pass least needs to look at.
// This stands in a plausible full dashboard so layout, density and the ember
// rule can actually be judged.
//
// Gated on POS_FIXTURES, which is set in one place: the `web-preview` entry in
// .claude/launch.json. It is not in .env.local, not in Vercel, and backend.js
// reads it through a server-only module, so no build can pick it up by
// accident.

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
const daysAhead = (d) => new Date(now + d * 86400_000).toISOString().slice(0, 10);


const BRIEF = {
  success: true,
  hasBrief: true,
  created_at: hoursAgo(3),
  content: `You've got three classes today and the marketing group project is due Friday — nobody has touched the shared deck since Sunday.

Spending is running hot: $312 in the last seven days against a normal week of about $180, almost all of it food. That's the third week in a row.

You told me in March you wanted to read twelve books this year. You're on two, and the last note about one was six weeks ago.

Rain from noon, so if the run is happening it's happening this morning.`
};


const DEEP_THOUGHTS = {
  thoughts: [
    {
      id: "fx-thought-1",
      topic: "Should I quit the internship to focus on the startup idea?",
      status: "ready",
      thread_status: "ready_to_build",
      created_at: hoursAgo(5),
      content: JSON.stringify({
        verdict: "Don't quit yet — set a decision date and a test that can actually fail.",
        reasoning:
          "You have eleven weeks left on the internship and no revenue on the other thing. Quitting now converts a known, paid, resume-legible position into unstructured time you have not yet proven you use well. The honest read is that the internship is boring, not that it is blocking you — you have had four free evenings a week for a month and shipped nothing.",
        pros: [
          "Full attention on the idea while you have no dependants and no rent risk",
          "The internship's reference value is already banked at three months"
        ],
        cons: [
          "No revenue, no users, and no dated plan yet",
          "You have quit two side projects at roughly this same point before"
        ],
        open_questions: [
          "What would have to be true by October for this to obviously be worth it?",
          "Who have you actually shown the idea to, outside your own head?"
        ]
      }),
      turns: [
        {
          id: "fx-turn-1",
          role: "user",
          message: "Fair. But I genuinely think I'd move faster with the whole day free."
        },
        {
          id: "fx-turn-2",
          role: "assistant",
          message:
            "Maybe. Test it cheaply first: take the four evenings you already have this week and ship one thing a stranger can use. If that happens, the full-day argument is real. If it doesn't, the internship was never what was stopping you."
        }
      ]
    }
  ]
};


const NUDGES = {
  nudges: [
    {
      id: "fx-nudge-1",
      message:
        "The group deck is due Friday and hasn't moved since Sunday. You're the one who set the Wednesday check-in.",
      created_at: hoursAgo(11),
      intentions: { content: "Stop being the person who does group work at 2am" }
    }
  ]
};


const PROMPTS = {
  prompts: [
    {
      id: "fx-prompt-1",
      kind: "label_place",
      title: null,
      body: "You've spent about an hour here three times this week, always late afternoon. What is it?",
      created_at: hoursAgo(2),
      payload: { maps_url: "https://maps.google.com/?q=40.5,-88.99" }
    },
    {
      id: "fx-prompt-2",
      kind: "relationship_checkin",
      title: "You haven't spoken to Marcus in 3 weeks",
      body: "You set a two-week cadence for him back in June. Last contact was a text on the 15th.",
      created_at: hoursAgo(20),
      payload: {}
    }
  ],

  // Insights ride back on the same call as prompts. Both shapes are here so
  // the two cards can be compared side by side locally — they sit in the same
  // queue and must not read as the same kind of thing: a prompt asks you
  // something, an insight tells you something and asks only whether it was
  // worth telling you.
  //
  // The second one is deliberately a synthesis — two findings the graph
  // confirmed were about the same project — because that is the case the
  // grouping exists for and the one hardest to picture from the code.
  insights: [
    {
      id: "fx-insight-1",
      kind: "insight",
      title: "Eating out vs. the cut",
      body: "You've spent $184 eating out in 30 days while the intention you saved on the 12th was to be lean by winter. That's the second-largest category this month.",
      created_at: hoursAgo(6),
      seen: false
    },
    {
      id: "fx-insight-2",
      kind: "insight",
      title: "The presentation is costing twice",
      body: "MKT 337 has taken $61 in printing and coffee since Tuesday and it's the same project Marcus is on — the one you haven't replied to in three weeks. The deadline is Thursday.",
      created_at: hoursAgo(30),
      seen: true
    }
  ]
};


const PROJECTS = {
  projects: [
    {
      id: "fx-proj-1",
      name: "MKT 337 group presentation",
      status: "active",
      description: "Ten-minute pitch on the Patagonia case, graded on delivery as much as content.",
      next_action: "Draft your three slides and drop them in the shared deck tonight.",
      tasks: [
        { id: "t1", title: "Read the case twice, take notes on the supply-chain section", status: "completed", due_date: daysAhead(-2) },
        { id: "t2", title: "Draft your three slides", status: "pending", due_date: daysAhead(0) },
        { id: "t3", title: "Send the deck to the group for comments", status: "pending", due_date: daysAhead(1) },
        { id: "t4", title: "Run through it out loud twice", status: "pending", due_date: daysAhead(2) }
      ],
      materials: [
        {
          id: "m1",
          title: "What the grader is actually looking for",
          content:
            "The rubric weights delivery at 40%. Most groups lose points on transitions between speakers, not on the analysis."
        }
      ]
    },
    {
      id: "fx-proj-2",
      name: "Relocate for the new role",
      status: "active",
      description: null,
      next_action: "Confirm the truck booking — the quote expires Thursday.",
      tasks: [
        { id: "t5", title: "Book the truck", status: "pending", due_date: daysAhead(1) },
        { id: "t6", title: "Cancel the Washington gym membership", status: "completed", due_date: daysAhead(-4) }
      ],
      materials: []
    }
  ]
};


const ARCHIVED_PROJECTS = {
  projects: [
    {
      id: "fx-proj-archived-1",
      name: "Spring internship applications",
      status: "archived",
      description: "Applied everywhere, accepted the one in June.",
      next_action: null,
      tasks: [
        { id: "t7", title: "Submit the last three applications", status: "completed", due_date: daysAhead(-90) }
      ],
      materials: []
    }
  ]
};


// Mirrors the real handler's shape: every range precomputed, plus the whole
// categorised window for the drilldowns. Built from a generated transaction
// list so the per-category totals and the transactions behind them actually
// agree — a fixture whose breakdown contradicts its own rows would make the
// drilldown look broken while the code was fine.
const FIXTURE_RANGES = [7, 30, 90];

const daysAgoISO = (d) => new Date(now - d * 86400_000).toISOString().slice(0, 10);

const FIXTURE_TX = [
  [0, "Trader Joe's", -42.10, "groceries"],
  [1, "Shell", -31.40, "transport"],
  [2, "Chipotle", -14.80, "eating out"],
  [3, "Trader Joe's", -38.25, "groceries"],
  [4, "CVS", -18.75, "health"],
  [5, "Amazon", -24.99, "shopping"],
  [6, "Spotify", -11.99, "software"],
  [9, "Comcast", -79.99, "housing"],
  [11, "Trader Joe's", -51.30, "groceries"],
  [13, "Shell", -29.80, "transport"],
  [15, "Chipotle", -16.40, "eating out"],
  [18, "Target", -38.00, "shopping"],
  [21, "Trader Joe's", -44.60, "groceries"],
  [24, "Shell", -22.90, "transport"],
  [26, "CVS", -23.00, "health"],
  [28, "Spotify", -11.99, "software"],
  [34, "Comcast", -79.99, "housing"],
  [41, "Trader Joe's", -47.80, "groceries"],
  [48, "Shell", -33.10, "transport"],
  [55, "Chipotle", -19.20, "eating out"],
  [63, "Amazon", -33.41, "shopping"],
  [70, "Spotify", -11.99, "software"],
  [78, "Comcast", -79.99, "housing"],
  [86, "Trader Joe's", -39.90, "groceries"]
].map(([d, merchant, amount, category]) => ({
  date: daysAgoISO(d), merchant, amount, category
}));


function summariseFixture(rows) {

  const spent = rows.reduce((t, r) => t + Math.abs(r.amount), 0);

  const byCategory = {};
  const byMerchant = {};

  for (const r of rows) {
    const mag = Math.abs(r.amount);
    byCategory[r.category] = (byCategory[r.category] || 0) + mag;
    if (!byMerchant[r.merchant]) byMerchant[r.merchant] = { merchant: r.merchant, total: 0, count: 0, category: r.category };
    byMerchant[r.merchant].total += mag;
    byMerchant[r.merchant].count += 1;
  }

  const round = (n) => Math.round(n * 100) / 100;

  return {
    spent: round(spent),
    earned: 1450,
    net: round(1450 - spent),
    transactionCount: rows.length,
    categories: Object.entries(byCategory)
      .map(([name, total]) => ({ name, total: round(total), share: spent > 0 ? Math.round((total / spent) * 1000) / 10 : 0 }))
      .sort((a, b) => b.total - a.total),
    merchants: Object.values(byMerchant)
      .map(m => ({ ...m, total: round(m.total) }))
      .sort((a, b) => b.total - a.total),
    recurring: [
      { merchant: "Comcast", amount: 79.99, occurrences: 3 },
      { merchant: "Spotify", amount: 11.99, occurrences: 4 }
    ],
    recent: rows.slice(0, 12)
  };

}


function financeFixture() {

  const cutoffs = {};
  const views = {};

  for (const range of FIXTURE_RANGES) {
    const cutoff = daysAgoISO(range);
    cutoffs[range] = cutoff;
    views[range] = summariseFixture(FIXTURE_TX.filter(t => t.date >= cutoff));
  }

  return {
    success: true,
    ranges: FIXTURE_RANGES,
    cached: true,
    fetchedAt: hoursAgo(2),
    accounts: [
      { name: "Checking", balance: 2140.55, currency: "USD" },
      { name: "Savings", balance: 3360.12, currency: "USD" }
    ],
    totalBalance: 5500.67,
    cutoffs,
    views,
    transactions: FIXTURE_TX
  };

}


const SETTINGS = {
  success: true,
  settings: {
    interruption_level: "digest_plus_urgent",
    auto_color_events: true,
    event_colors: {},
    persisted: true
  },
  levels: ["silent", "digest", "digest_plus_urgent", "everything"]
};


// The graph, as it looks once merchants and categories are entities.
//
// Shaped from the real thing rather than invented freely: one project holding
// most of the edges, with tasks and charges as its two big groups, plus the
// mid-sized hubs money adds. Every name here is fictional (this repo is public
// and carries no real personal data) but the SHAPE is measured — 12 tasks and
// 8 charges around one project is the live distribution, and it is the case the
// layout has to survive.
const graphNode = (type, id, label, relation, direction, extra) => ({
  type, id, label, relation, direction,
  confidence: 1, distance: 1, source: "explicit",
  when: hoursAgo(40), ...(extra !== undefined ? { extra } : {})
});

const GRAPH_NEIGHBOURHOODS = {

  "project:fx-p1": {
    root: { type: "project", id: "fx-p1", label: "Coastal Rebrand", when: hoursAgo(20) },
    nodes: [
      ...[
        "Rewrite the positioning page", "Book the photographer", "Send the brief to Marisol",
        "Collect logo feedback", "Pick the final typeface", "Order sample prints",
        "Draft the launch email", "Schedule the reveal", "Update the deck template",
        "Sort out the domain", "Write the press one-pager", "Chase the invoice"
      ].map((t, i) => graphNode("task", `fx-t${i}`, t, "belongs_to", "in")),
      ...[
        ["Northline Supply", 146.8], ["Northline Supply", 62.4], ["Framewright", 240],
        ["Northline Supply", 88.15], ["Paper & Press", 31.9], ["Framewright", 120],
        ["Bellhouse Studio", 410], ["Paper & Press", 18.6]
      ].map(([m, a], i) => graphNode("transaction", `fx-x${i}`, m, "spent_on", "in", a)),
      graphNode("deep_thought", "fx-d1", "Is the rebrand worth finishing before the launch?", "belongs_to", "in"),
      graphNode("deep_thought", "fx-d2", "What would I cut if the budget halved?", "mentions", "in"),
      graphNode("intention", "fx-i1", "Ship the new site before the end of the quarter", "mentions", "in")
    ]
  },

  // The hub money adds, and the reason merchants became entities: a NOTE
  // reaches a merchant reaches every charge there. None of that was possible
  // when a merchant was only a string on a row.
  "merchant:northline supply": {
    root: { type: "merchant", id: "northline supply", label: "Northline Supply", when: hoursAgo(30) },
    nodes: [
      ...[146.8, 62.4, 88.15, 34.2, 19.99, 205.5, 77.4].map((a, i) =>
        graphNode("transaction", `fx-nx${i}`, "Northline Supply", "paid_to", "in", a)),
      graphNode("note", "fx-n1", "Need to return the extra roll to Northline Supply", "mentions", "in"),
      graphNode("project", "fx-p1", "Coastal Rebrand", "mentions", "in"),
      graphNode("category", "supplies", "Supplies", "categorised_as", "out", 14)
    ]
  },

  "category:groceries": {
    root: { type: "category", id: "groceries", label: "Groceries", when: hoursAgo(12) },
    nodes: [
      ...[["Fenwick Market", 84.2], ["Fenwick Market", 61.05], ["Harbour Foods", 122.4],
          ["Fenwick Market", 39.9], ["Harbour Foods", 55.15]].map(([m, a], i) =>
        graphNode("transaction", `fx-gx${i}`, m, "categorised_as", "in", a)),
      graphNode("intention", "fx-i2", "Cook at home four nights a week", "mentions", "in")
    ]
  },

  "person:fx-per1": {
    root: { type: "person", id: "fx-per1", label: "Marisol Vega", when: hoursAgo(60) },
    nodes: [
      graphNode("task", "fx-t2", "Send the brief to Marisol", "mentions", "in"),
      graphNode("project", "fx-p1", "Coastal Rebrand", "mentions", "in"),
      graphNode("event", "fx-e1", "Review call, Thursday 2pm", "mentions", "in"),
      graphNode("note", "fx-n2", "Marisol prefers Figma comments over email", "mentions", "in")
    ]
  }

};

const GRAPH_ANCHORS = {
  success: true,
  anchors: [
    { type: "project", id: "fx-p1", degree: 23, label: "Coastal Rebrand", when: hoursAgo(20) },
    { type: "merchant", id: "northline supply", degree: 10, label: "Northline Supply", when: hoursAgo(30), extra: 7 },
    { type: "category", id: "groceries", degree: 6, label: "Groceries", when: hoursAgo(12), extra: 43 },
    { type: "person", id: "fx-per1", degree: 4, label: "Marisol Vega", when: hoursAgo(60) },
    { type: "intention", id: "fx-i1", degree: 3, label: "Ship the new site before the end of the quarter", when: hoursAgo(90) }
  ]
};


const FIXTURES = {
  "/api/brief/latest?peek=true": BRIEF,
  "/api/deepThoughts": DEEP_THOUGHTS,
  "/api/data?prompts=1": PROMPTS,
  "/api/nudges": NUDGES,
  "/api/projects": PROJECTS,
  "/api/projects?status=archived": ARCHIVED_PROJECTS,
  "/api/settings": SETTINGS
};


export function fixtureFor(path) {

  if (path.startsWith("/api/finance")) return financeFixture();

  if (path.startsWith("/api/graph")) {

    const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));

    const type = query.get("type");
    const id = query.get("id");

    if (!type || !id) return GRAPH_ANCHORS;

    const found = GRAPH_NEIGHBOURHOODS[`${type}:${id}`];

    // A fixture neighbourhood that does not exist answers the way the real
    // endpoint does — an error, not an empty walk. A preview that renders
    // "connected to nothing" for a missing fixture would look like a bug in the
    // page rather than a gap in the fixtures.
    return found
      ? { success: true, depth: 1, ...found }
      : { error: "That entity no longer exists" };

  }

  return FIXTURES[path] || null;

}
