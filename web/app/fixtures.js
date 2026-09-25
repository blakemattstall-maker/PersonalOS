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
  content: `The Coastal Rebrand review is Thursday at 2:00 PM. Marisol has answered the positioning comments; the open decision is whether the photo library can wait until after launch.

You spent $448 on project supplies in the last 30 days. $360 is tied directly to sample prints and framing, so it is visible in the project graph instead of being mistaken for ordinary shopping.

Your latest weigh-in is 177.8 lbs, down 4.6 since the start of this eight-week block and moving at roughly 0.6 lbs per week.

One thing needs you: approve the final typeface before tomorrow's review. Nothing else is urgent.`
};


const DEEP_THOUGHTS = {
  thoughts: [
    {
      id: "fx-thought-1",
      topic: "Should the Coastal Rebrand launch before the photo library is final?",
      status: "ready",
      thread_status: "ready_to_build",
      created_at: hoursAgo(5),
      content: JSON.stringify({
        verdict: "Launch the core identity on schedule and stage the photo library as a dated second release.",
        reasoning:
          "The positioning, type system and launch page are ready. Waiting for every photo would move the launch three weeks and block work that does not depend on them. The risk is a thin first impression, so the launch needs a deliberately limited image set and a public date for the full library.",
        pros: [
          "The client can start using the new system on schedule",
          "A smaller first release creates a real feedback checkpoint"
        ],
        cons: [
          "The first launch will not show the complete visual range",
          "The second release needs an owner and a date or it will drift"
        ],
        open_questions: [
          "Which five images are enough to make the launch feel intentional?",
          "Can Marisol own the remaining selects by next Friday?"
        ]
      }),
      turns: [
        {
          id: "fx-turn-1",
          role: "user",
          message: "I worry the smaller library will make the identity look unfinished."
        },
        {
          id: "fx-turn-2",
          role: "assistant",
          message:
            "Then make the limitation explicit in the art direction: one restrained image family at launch, followed by the broader library next Friday. A narrow system can look deliberate; an unexplained gap looks unfinished."
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
        "The type decision is blocking the deck, launch page and print order. You said you wanted it closed before Thursday's review.",
      created_at: hoursAgo(11),
      intentions: { content: "Ship the Coastal Rebrand before the end of the quarter" }
    }
  ]
};


const PROMPTS = {
  prompts: [
    {
      id: "fx-prompt-1",
      kind: "clarification",
      title: "Which Jordan did you mean?",
      body: "I found two people named Jordan. Pick the client contact connected to Coastal Rebrand before I draft the update.",
      created_at: hoursAgo(2),
      payload: {}
    },
    {
      id: "fx-prompt-2",
      kind: "relationship_checkin",
      title: "Marisol's check-in is overdue",
      body: "You set a monthly cadence. The project has been active, but your last personal check-in was 34 days ago.",
      created_at: hoursAgo(20),
      payload: {}
    },

    {
      id: "fx-prompt-3",
      kind: "capture_result",
      title: "Client review brief is ready",
      body:
        "I researched three comparable launches, compared them with your Coastal Rebrand work log, created a six-section Google Doc, drafted the client email, and added Friday's follow-up task.\n" +
        "https://docs.google.com/document/d/1ALMANACSHOWCASEINTERVIEWPREP1234567890/edit",
      created_at: hoursAgo(1),
      payload: { chained: true }
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
      title: "The cut is moving without extreme changes",
      body: "Your last eight weeks moved from 182.4 to 177.8 lbs at roughly 0.6 lbs per week. Eating out fell twice in the same period, so there is no evidence you need a harder intervention.",
      created_at: hoursAgo(6),
      seen: false
    },
    {
      id: "fx-insight-2",
      kind: "insight",
      title: "The rebrand is costing more than it looks",
      body: "Coastal Rebrand has $448 in tagged supplies and framing plus twelve open tasks. The next expensive order should wait until the type decision closes tomorrow.",
      created_at: hoursAgo(30),
      seen: true
    }
  ]
};


const PROJECTS = {
  projects: [
    {
      id: "fx-proj-1",
      name: "Coastal Rebrand",
      status: "active",
      description: "Identity, launch page and client rollout for a fictional coastal hospitality studio.",
      next_action: "Approve the final typeface before Thursday's 2:00 PM review.",
      tasks: [
        { id: "t1", title: "Rewrite the positioning page", status: "completed", due_date: daysAhead(-2) },
        { id: "t2", title: "Approve the final typeface", status: "pending", due_date: daysAhead(0) },
        { id: "t3", title: "Send the review deck to Marisol", status: "pending", due_date: daysAhead(1) },
        { id: "t4", title: "Rehearse the client walkthrough", status: "pending", due_date: daysAhead(2) }
      ],
      materials: [
        {
          id: "m1",
          title: "Comparable launch research",
          content:
            "The strongest comparable launches used one controlled image family first, then expanded the library after the core identity had landed."
        }
      ]
    },
    {
      id: "fx-proj-2",
      name: "Fall portfolio refresh",
      status: "active",
      description: null,
      next_action: "Write the Coastal Rebrand case-study outcome section.",
      tasks: [
        { id: "t5", title: "Select six case-study frames", status: "pending", due_date: daysAhead(3) },
        { id: "t6", title: "Export the mobile prototype", status: "completed", due_date: daysAhead(-4) }
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

const HEALTH = {
  success: true,
  vitals: {
    unit: "lbs",
    start: { weight: 182.4, date: "Jul 30, 2026" },
    current: { weight: 177.8, date: "Sep 24, 2026" },
    totalChange: -4.6,
    daysSinceLast: 0,
    pacePerWeek: -0.6,
    count: 19,
    recent: [
      "Sep 24, 2026: 177.8 lbs", "Sep 20, 2026: 178.3 lbs",
      "Sep 16, 2026: 178.7 lbs", "Sep 12, 2026: 179.1 lbs",
      "Sep 8, 2026: 179.6 lbs", "Sep 3, 2026: 180.0 lbs"
    ]
  }
};

const DATA = {
  success: true,
  memories: [
    { id: "fx-memory-1", type: "preference", importance: 8, content: "Marisol prefers project feedback in Figma comments, not long email threads.", created_at: hoursAgo(24 * 19) },
    { id: "fx-memory-2", type: "work", importance: 7, content: "Coastal Rebrand launches in two stages: core identity first, expanded photo library the following Friday.", created_at: hoursAgo(12) }
  ],
  notes: [
    { id: "fx-note-1", content: "Return the unused paper roll to Northline Supply after the print review.", created_at: hoursAgo(30) },
    { id: "fx-note-2", content: "The client reacted best to the quieter type system and the single-image launch direction.", created_at: hoursAgo(8) }
  ],
  intentions: [
    { id: "fx-intention-1", content: "Ship the Coastal Rebrand before the end of the quarter.", status: "active", created_at: hoursAgo(24 * 28) },
    { id: "fx-intention-2", content: "Lose weight slowly enough that training performance stays stable.", status: "active", created_at: hoursAgo(24 * 56) }
  ]
};

const HISTORY = {
  success: true,
  thoughts: [],
  nudges: [
    { id: "fx-history-n1", message: "The frame order is ready, but the invoice is still unsent.", created_at: hoursAgo(24 * 2), intentions: { content: "Close small project loops the same day" } }
  ],
  briefs: [
    { id: "fx-history-b1", created_at: hoursAgo(24), content: "Yesterday: the launch page moved to review, spending stayed inside the project budget, and no relationship follow-up was urgent." },
    { id: "fx-history-b2", created_at: hoursAgo(48), content: "Two days ago: Marisol returned the photo selects. The typeface decision became the only blocker shared by the deck, site and print order." }
  ]
};

const NEWS = {
  success: true,
  items: [
    { id: "fx-news-1", category: "technology", source: "The Verge", headline: "Design teams are moving more of the review loop into shared prototypes", summary: "New collaboration releases continue to compress the distance between a design decision and client approval.", relevance: "Coastal Rebrand is currently waiting on one type decision across the deck, site and print order—the exact coordination problem these workflows target.", context: "Creative teams have gradually shifted review from exported files toward shared, inspectable systems.", viewpoints: [{ label: "Faster iteration", take: "One source of truth reduces stale exports and repeated feedback." }, { label: "Process risk", take: "Clients can mistake access to the working file for a need to comment on every detail." }], surfaced_at: hoursAgo(4) },
    { id: "fx-news-2", category: "business", source: "Fast Company", headline: "Small studios are packaging strategy and production into one engagement", summary: "Independent creative teams are selling connected outcomes instead of isolated deliverables.", relevance: "Your portfolio refresh is trying to explain Coastal Rebrand as a system, not a collection of assets.", context: "Buyers increasingly expect positioning, identity and launch execution to arrive as one coherent engagement.", viewpoints: [], surfaced_at: hoursAgo(7) },
    { id: "fx-news-3", category: "science", source: "Nature Briefing", headline: "Steady behavior changes outperform dramatic short interventions", summary: "A new review adds evidence that adherence matters more than aggressive short-term targets.", relevance: "Your eight-week weight trend is moving at 0.6 lbs per week without a sharp change in routine.", context: "Long-term outcomes often depend on whether a routine remains tolerable after the initial motivation fades.", viewpoints: [], surfaced_at: hoursAgo(10) }
  ]
};

const PRACTICE = {
  success: true,
  topics: [
    { id: "fx-topic-1", title: "Should creative work launch before every asset is final?", category: "society", used_count: 1, tension: "Shipping creates feedback and momentum, while incompleteness can weaken the first impression.", context: "Many identity systems now launch in staged releases, but clients still judge the first public version as complete.", side_a: "Launch the finished core system on schedule", side_b: "Wait until the complete asset library is ready" },
    { id: "fx-topic-2", title: "Should personal software make proactive judgments?", category: "technology", used_count: 2, tension: "Useful assistants need initiative, but initiative can become noise or unwanted influence.", context: "The design problem is less whether software can notice patterns than how often it earns the right to interrupt.", side_a: "A personal system should surface unrequested conclusions", side_b: "It should only respond when explicitly asked" }
  ]
};

const PRACTICE_SESSIONS = {
  success: true,
  sessions: [
    { id: "fx-session-1", type: "debate", status: "completed", created_at: hoursAgo(26), debate_topics: { title: "Should personal software make proactive judgments?" } },
    { id: "fx-session-2", type: "pitch", mode: "explainer", topic: "Explain the Coastal Rebrand strategy in 60 seconds", status: "completed", created_at: hoursAgo(50) }
  ]
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


// A believable dining day — station names and recipes are invented, numbers
// are plausible. Shaped exactly like tools/dining.js getDiningDay().
function diningFixture(path) {

  const wanted = (path.match(/date=(\d{4}-\d{2}-\d{2})/) || [])[1] || daysAhead(0);

  // The Plan tab's read — a believable mid-day: breakfast tracked, dinner
  // planned, targets set, so totals, both lists and the remove affordances
  // can all be judged locally.
  if (/[?&]log=1/.test(path)) {
    return {
      success: true,
      configured: true,
      date: wanted,
      eaten: [
        {
          id: "fx-log-1",
          date: wanted,
          meal: "Breakfast",
          status: "eaten",
          station: "Homestyle",
          items: [
            { name: "Scrambled Eggs", serving: "#12 Scoop", station: "Homestyle", quantity: 2, calories: 140, protein_g: 7.5, carbs_g: 1, fat_g: 10 },
            { name: "Turkey Sausage Links", serving: "2 Links", station: "Homestyle", quantity: 1, calories: 130, protein_g: 13, carbs_g: 2, fat_g: 8 }
          ],
          calories: 410, protein_g: 28, carbs_g: 4, fat_g: 28,
          source: "app", event_id: null, note: null
        }
      ],
      planned: [
        {
          id: "fx-log-2",
          date: wanted,
          meal: "Dinner",
          status: "planned",
          station: "Homestyle",
          items: [
            { name: "Braised Beef Tips", serving: "6 Oz. Spoodle", station: "Homestyle", quantity: 1, calories: 310, protein_g: 34, carbs_g: 6, fat_g: 16 },
            { name: "Roasted Root Vegetables", serving: "1/2 Cup", station: "Homestyle", quantity: 1, calories: 90, protein_g: 2, carbs_g: 15, fat_g: 3 },
            { name: "Herbed Quinoa", serving: "1/2 Cup", station: "Greens & Grains", quantity: 1, calories: 130, protein_g: 5, carbs_g: 22, fat_g: 3 }
          ],
          calories: 530, protein_g: 41, carbs_g: 43, fat_g: 22,
          source: "planner", event_id: "fx-event-1",
          note: "5:00 PM · best protein-to-calorie plate tonight"
        }
      ],
      totals: { calories: 410, protein_g: 28, carbs_g: 4, fat_g: 28 },
      targets: { calories: 2400, protein_g: 150 }
    };
  }

  const label = (calories, protein, fat, carbs, sodium) => ({
    calories, calories_from_fat: Math.round(fat * 9),
    fat_g: fat, fat_dv: Math.round(fat / 0.78),
    sat_fat_g: Math.round(fat * 0.3 * 10) / 10, sat_fat_dv: Math.round(fat * 1.5),
    trans_fat_g: null,
    cholesterol_mg: Math.round(protein * 2.5), cholesterol_dv: Math.round(protein / 1.2),
    sodium_mg: sodium, sodium_dv: Math.round(sodium / 23),
    carbs_g: carbs, carbs_dv: Math.round(carbs / 2.75),
    fiber_g: carbs > 10 ? Math.round(carbs / 8) : null, fiber_dv: null,
    sugars_g: null,
    protein_g: protein, protein_dv: Math.round(protein * 2),
    vitamin_a_dv: 4, vitamin_c_dv: 10, calcium_dv: 6, iron_dv: 8
  });

  const item = (name, serving, course, traits, nutrition, allergens = []) =>
    ({ name, serving, course, traits, allergens, nutrition, ingredients: null, recipe: name.toLowerCase() });

  // All-day stations (salad bar, beverages) ride along under every meal.
  const saladBar = {
    station: "Greens & Grains",
    allDay: true,
    items: [
      item("Spinach & Feta Salad", "1 Cup", "Salads", ["Vegetarian"], label(110, 5, 7, 8, 320), ["Milk"]),
      item("Herbed Quinoa", "1/2 Cup", "Grains", ["Vegan", "Vegetarian"], label(130, 5, 3, 22, 180))
    ]
  };

  return {
    success: true,
    configured: true,
    date: wanted,
    today: daysAhead(0),
    dates: [0, 1, 2, 3, 4, 5, 6].map(daysAhead),
    suggestedMeal: "Dinner",
    lastSynced: hoursAgo(5),
    meals: [
      {
        meal: "Lunch",
        stations: [
          {
            station: "Homestyle",
            items: [
              item("Herb Roasted Chicken", "1/4 Chicken", "Entrees", ["Halal"], label(280, 32, 14, 2, 480)),
              item("Garlic Mashed Potatoes", "1/2 Cup", "Sides", ["Vegetarian"], label(160, 3, 6, 24, 310), ["Milk"]),
              item("Green Beans", "1/2 Cup", "Sides", ["Vegan", "Vegetarian"], label(45, 2, 1, 8, 190))
            ]
          },
          {
            station: "Fire Kitchen",
            items: [
              item("Chana Masala", "8 Oz. Ladle", "Entrees", ["Vegan", "Vegetarian"], label(240, 11, 7, 34, 620)),
              item("Basmati Rice", "1/2 Cup", "Sides", ["Vegan"], label(150, 3, 0.5, 33, 5))
            ]
          },
          saladBar
        ]
      },
      {
        meal: "Dinner",
        stations: [
          {
            station: "Homestyle",
            items: [
              item("Braised Beef Tips", "6 Oz. Spoodle", "Entrees", ["Halal"], label(310, 34, 16, 6, 540)),
              item("Buttered Egg Noodles", "1/2 Cup", "Sides", ["Vegetarian"], label(190, 6, 7, 26, 220), ["Eggs", "Wheat"]),
              item("Roasted Root Vegetables", "1/2 Cup", "Sides", ["Vegan", "Vegetarian"], label(90, 2, 3, 15, 240))
            ]
          },
          {
            station: "Noodle Bar",
            items: [
              item("Miso Ramen", "12 Oz. Bowl", "Entrees", ["Vegetarian"], label(380, 14, 11, 55, 980), ["Soy", "Wheat"]),
              item("Chili Crisp Tofu", "4 Oz.", "Toppings", ["Vegan"], label(140, 12, 9, 4, 330), ["Soy"])
            ]
          },
          saladBar
        ]
      }
    ]
  };

}


const FIXTURES = {
  "/api/brief/latest?peek=true": BRIEF,
  "/api/people": PEOPLE,
  "/api/health": HEALTH,
  "/api/data": DATA,
  "/api/deepThoughts": DEEP_THOUGHTS,
  "/api/data?prompts=1": PROMPTS,
  "/api/nudges": NUDGES,
  "/api/history": HISTORY,
  "/api/news": NEWS,
  "/api/practice": PRACTICE,
  "/api/practice?sessions=1": PRACTICE_SESSIONS,
  "/api/projects": PROJECTS,
  "/api/projects?status=archived": ARCHIVED_PROJECTS,
  "/api/settings": SETTINGS
};


export function fixtureFor(path) {

  if (path.startsWith("/api/finance")) return financeFixture();

  if (path.startsWith("/api/graph")) return GRAPH;

  if (path.startsWith("/api/dining")) return diningFixture(path);

  return FIXTURES[path] || null;

}
