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


// The graph, whole, as the force view eats it. Shaped like the measured real
// one — one project hub holding tasks and charges, merchant and category hubs
// from the money promotion, a few people, notes reaching across — but every
// name is fictional: this repo is public.
const GRAPH = (() => {

  const nodes = [];
  const links = [];

  const put = (id, type, label, extra) => {
    if (!nodes.some(n => n.id === id)) {
      nodes.push({ id, type, label, when: hoursAgo(40), ...(extra !== undefined && { extra }), val: 1 });
    }
    return id;
  };

  const join = (source, target, relation) => links.push({ source, target, relation });

  const project = put("project:fx-p1", "project", "Coastal Rebrand");
  const marisol = put("person:fx-per1", "person", "Marisol Vega");
  const dev = put("person:fx-per2", "person", "Dev Okafor");

  [
    "Rewrite the positioning page", "Book the photographer", "Send the brief to Marisol",
    "Collect logo feedback", "Pick the final typeface", "Order sample prints",
    "Draft the launch email", "Schedule the reveal", "Update the deck template",
    "Sort out the domain", "Write the press one-pager", "Chase the invoice"
  ].forEach((title, i) => join(put(`task:fx-t${i}`, "task", title), project, "belongs_to"));

  join("task:fx-t2", marisol, "mentions");
  join("task:fx-t3", dev, "mentions");

  const groceries = put("category:groceries", "category", "Groceries", 9);
  const supplies = put("category:supplies", "category", "Supplies", 9);
  const eatingOut = put("category:eating out", "category", "Eating Out", 4);

  const MERCHANTS = {
    northline: put("merchant:northline supply", "merchant", "Northline Supply", 7),
    fenwick: put("merchant:fenwick market", "merchant", "Fenwick Market", 6),
    harbour: put("merchant:harbour foods", "merchant", "Harbour Foods", 3),
    framewright: put("merchant:framewright", "merchant", "Framewright", 2)
  };

  let x = 0;

  const charge = (merchantKey, amount, category, onProject) => {
    const merchant = MERCHANTS[merchantKey];
    const id = put(`transaction:fx-x${x++}`, "transaction",
      nodes.find(n => n.id === merchant).label, amount);
    join(id, merchant, "paid_to");
    join(id, category, "categorised_as");
    if (onProject) join(id, project, "spent_on");
  };

  [146.8, 62.4, 88.15, 34.2, 19.99, 205.5, 77.4].forEach(a => charge("northline", a, supplies, a > 60));
  [84.2, 61.05, 39.9, 27.6, 93.3, 55.15].forEach(a => charge("fenwick", a, groceries, false));
  [122.4, 55.15, 61.8].forEach(a => charge("harbour", a, groceries, false));
  [31.5, 12.8, 47.2, 22.9].forEach(a => charge("fenwick", a, eatingOut, false));
  [240, 120].forEach(a => charge("framewright", a, supplies, true));

  join(put("note:fx-n1", "note", "Need to return the extra roll to Northline Supply"), MERCHANTS.northline, "mentions");
  join(put("note:fx-n2", "note", "Marisol prefers Figma comments over email"), marisol, "mentions");
  join(put("intention:fx-i1", "intention", "Ship the new site before the end of the quarter"), project, "mentions");
  join(put("intention:fx-i2", "intention", "Cook at home four nights a week"), eatingOut, "mentions");
  join(put("deep_thought:fx-d1", "deep_thought", "Is the rebrand worth finishing before the launch?"), project, "belongs_to");
  const review = put("event:fx-e1", "event", "Review call, Thursday 2pm");
  join(review, marisol, "mentions");
  join(review, project, "belongs_to");

  // val = distinct neighbours, the same figure fullGraph() computes.
  const seen = new Map();
  for (const l of links) {
    if (!seen.has(l.source)) seen.set(l.source, new Set());
    if (!seen.has(l.target)) seen.set(l.target, new Set());
    seen.get(l.source).add(l.target);
    seen.get(l.target).add(l.source);
  }
  for (const n of nodes) n.val = (seen.get(n.id) || new Set()).size || 1;

  return { success: true, nodes, links };

})();


// Entirely fictional people — this repo is public. The two states worth
// looking at: one person with every field filled and a check-in due (the
// ember path), one nearly bare (what a voice-created person looks like).
const PEOPLE = {
  success: true,
  people: [
    {
      id: "fx-per1",
      name: "Marisol Vega",
      relationship: "design school friend",
      notes: "Prefers Figma comments over email. Ask about the Portland move.",
      email: "marisol@example.com",
      phone: "(555) 014-2288",
      check_in_days: 30,
      last_contacted_at: hoursAgo(24 * 34),
      next_check_in_at: hoursAgo(48),
      important_date_month: 3,
      important_date_day: 14,
      important_date_label: "Birthday"
    },
    {
      id: "fx-per2",
      name: "Dev Okafor",
      relationship: null,
      notes: null,
      email: null,
      phone: null,
      check_in_days: null,
      last_contacted_at: hoursAgo(6),
      next_check_in_at: null,
      important_date_month: null,
      important_date_day: null,
      important_date_label: null
    }
  ]
};


const FIXTURES = {
  "/api/brief/latest?peek=true": BRIEF,
  "/api/people": PEOPLE,
  "/api/deepThoughts": DEEP_THOUGHTS,
  "/api/data?prompts=1": PROMPTS,
  "/api/nudges": NUDGES,
  "/api/projects": PROJECTS,
  "/api/projects?status=archived": ARCHIVED_PROJECTS,
  "/api/settings": SETTINGS
};


export function fixtureFor(path) {

  if (path.startsWith("/api/finance")) return financeFixture();

  if (path.startsWith("/api/graph")) return GRAPH;

  return FIXTURES[path] || null;

}
