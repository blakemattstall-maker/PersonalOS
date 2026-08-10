import supabase, { selectAll } from "../lib/supabase.js";
import openai from "../lib/openai.js";
import { MODELS } from "../lib/models.js";
import { DateTime } from "luxon";
import { link, linkMany, mentionsIn, merchantKey, clearEntityCache, pruneDangling, neighbours, linksReady } from "../lib/links.js";
import { getUserTimezone } from "../lib/profile.js";
import { loadMoney } from "../lib/money.js";


// The hivemind layer.
//
// lib/links.js holds edges. This puts them there, then walks them looking for
// things no single table could know, and pushes what it finds.
//
// The division of labour is the same one used everywhere else in this codebase
// and it matters most here: every finding below is DETECTED in code from facts
// already in the database, and the model is only ever asked to phrase it. An
// insight is a claim about someone's life — "you keep spending on X while
// saying you want Y" — and a model inventing those would produce confident,
// specific, unfalsifiable nonsense. Detected findings can be wrong, but they
// can be checked.


// ── Persisting money so it can be linked at all ──────────────────────────
//
// Transactions have only ever been a cached blob from the bank, so no charge
// could belong to a project, a person or a place. These rows are the anchor
// every money edge needs.
export async function syncTransactions({ days = 90 } = {}) {

  // Classified with the model here, unlike the signals path: these rows are
  // written once and then read by the detectors and the money edges for as
  // long as they exist, so the finer breakdown is worth one call a night.
  const { transactions } = await loadMoney({ days, classifyUnknown: true });

  if (transactions.length === 0) return { success: true, stored: 0 };

  const rows = transactions.map(t => ({
    external_id: t.id,
    account: t.account,
    posted_at: new Date(t.date).toISOString(),
    amount: Number(t.amount),
    merchant: t.merchant,
    description: t.description,
    category: t.category
  }));

  // Keyed on the bank's own id, so a re-sync updates rather than doubles.
  const { error } = await supabase
    .from("transactions")
    .upsert(rows, { onConflict: "external_id" });

  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return { success: false, skipped: "transactions table not created yet" };
    }
    throw new Error(error.message);
  }

  return { success: true, stored: rows.length };

}


// ── Extraction ───────────────────────────────────────────────────────────

const TEXT_SOURCES = [
  { type: "memory", table: "memories", field: "content" },
  { type: "note", table: "notes", field: "content" },
  { type: "intention", table: "intentions", field: "content" },
  { type: "deep_thought", table: "deep_thoughts", field: "content" },
  { type: "task", table: "tasks", field: "title" },
  { type: "event", table: "calendar_events", field: "title" }
];


// Every scan below used to be a bare `.limit(500)` with no pagination and no
// signal, so past 500 rows it stopped seeing the oldest ones — silently, while
// still reporting success. Old connections would simply disappear from the
// graph. selectAll() pages and says so if it ever runs out of room.
const MAX_ROWS_PER_TABLE = 10000;


async function scanTable(table, columns) {

  const { rows, error } = await selectAll(table, columns, {
    max: MAX_ROWS_PER_TABLE,
    // Ordered so the paging window is stable — see the note in selectAll.
    modify: q => q.order("id", { ascending: true })
  });

  if (error) console.error(`LINK SCAN ${table} FAILED:`, error.message);

  return rows;

}


// Merchants and categories, promoted from columns to rows.
//
// The graph's problem was never the edge-writing — it was that there was almost
// nothing to write edges TO. Nine people, one project and two places was the
// entire roster, so one project ended up holding 65% of every connection in the
// system while 119 of 129 transactions floated unattached.
//
// This derives ~44 merchants and 11 categories from money that is already
// stored, and every edge it writes is a restatement of a column rather than a
// judgement: this charge was at this merchant, this charge is in this category.
// Nothing is guessed, which is what lets the result be treated as fact
// downstream.
//
// Rebuilt from transactions every run rather than maintained incrementally. It
// is one scan of a table the caller is about to scan anyway, and it means a
// merchant can never drift out of step with the charges that define it — the
// failure the money summariser already produced once by keeping its own totals.
async function promoteMoneyEntities() {

  const txns = await scanTable("transactions", "id, merchant, category, amount, posted_at");

  if (txns.length === 0) return { edges: 0, merchants: 0, categories: 0 };

  const merchants = new Map();
  const categories = new Map();

  for (const t of txns) {

    const key = merchantKey(t.merchant);

    if (key) {

      const seen = merchants.get(key) || {
        id: key,
        name: String(t.merchant).trim(),
        txn_count: 0,
        total_amount: 0,
        first_seen_at: t.posted_at,
        last_seen_at: t.posted_at
      };

      seen.txn_count += 1;
      seen.total_amount += Number(t.amount) || 0;

      // The display name is whichever spelling the bank used most recently —
      // "Salt & Straw" and "Salt and Straw" collapse to one key, and picking
      // the newer spelling means a merchant that rebrands follows along.
      if (t.posted_at >= seen.last_seen_at) {
        seen.last_seen_at = t.posted_at;
        seen.name = String(t.merchant).trim();
      }

      if (t.posted_at < seen.first_seen_at) seen.first_seen_at = t.posted_at;

      merchants.set(key, seen);

    }

    const category = String(t.category || "").trim().toLowerCase();

    if (category) {

      const seen = categories.get(category) || {
        id: category,
        // Title case for display; the id stays exactly the string the detectors
        // already emit as a ref, so an insight's stored evidence resolves
        // against this table without translation.
        name: category.replace(/\b\w/g, c => c.toUpperCase()),
        txn_count: 0,
        total_amount: 0,
        updated_at: new Date().toISOString()
      };

      seen.txn_count += 1;
      seen.total_amount += Number(t.amount) || 0;

      categories.set(category, seen);

    }

  }

  const [mErr, cErr] = await Promise.all([
    supabase.from("merchants").upsert([...merchants.values()], { onConflict: "id" }).then(r => r.error),
    supabase.from("spend_categories").upsert([...categories.values()], { onConflict: "id" }).then(r => r.error)
  ]);

  // The migration is pasted by hand, so until docs/schema-merchants.sql is run
  // this reports zero and rebuildLinks carries on with the roster it had. Same
  // posture as every other read in this layer: a missing table looks like a
  // system that has not noticed anything, not a broken one.
  if (mErr || cErr) {
    console.error("PROMOTE MONEY ENTITIES FAILED:", (mErr || cErr).message);
    return { edges: 0, merchants: 0, categories: 0 };
  }

  // The roster is cached for a minute and was loaded before these rows existed.
  // Without this the text scan that runs next would match against the OLD list
  // and every merchant edge would wait for tomorrow's pass.
  clearEntityCache();

  const edges = [];

  for (const t of txns) {

    const key = merchantKey(t.merchant);

    if (key) {
      edges.push({
        from: { type: "transaction", id: t.id },
        to: { type: "merchant", id: key },
        relation: "paid_to",
        source: "explicit",
        context: `${t.merchant} ${t.amount}`
      });
    }

    const category = String(t.category || "").trim().toLowerCase();

    if (category) {
      edges.push({
        from: { type: "transaction", id: t.id },
        to: { type: "category", id: category },
        relation: "categorised_as",
        source: "explicit"
      });
    }

  }

  return {
    edges: await linkMany(edges),
    merchants: merchants.size,
    categories: categories.size
  };

}


export async function rebuildLinks() {

  if (!(await linksReady())) {
    return { success: false, skipped: "entity_links table not created yet" };
  }

  let created = 0;

  // Merchants and categories first, because they become part of the roster the
  // text scan below matches against. Run in the other order and a note saying
  // "picked it up at Costco" would not link until the NEXT nightly pass.
  const promoted = await promoteMoneyEntities();

  created += promoted.edges;

  // Text -> person / project / place / merchant, by name. mentionsIn() owns the
  // per-type rules — a merchant is not matched on its first word the way a
  // person is. See PARTIAL_NAME_TYPES in lib/links.js.
  for (const source of TEXT_SOURCES) {

    const rows = await scanTable(source.table, `id, ${source.field}`);

    for (const row of rows) {

      const text = row[source.field];

      for (const hit of await mentionsIn(text)) {

        const made = await link({
          from: { type: source.type, id: row.id },
          to: { type: hit.type, id: hit.id },
          relation: "mentions",
          confidence: hit.confidence ?? 1,
          context: text
        });

        if (made) created++;

      }

    }

  }


  // Structural edges the foreign keys already imply. Walking one graph is
  // simpler than remembering which relationships live in columns and which
  // live in edges.
  for (const [table, type, column, targetType] of [
    ["tasks", "task", "project_id", "project"],
    ["tasks", "task", "person_id", "person"],
    ["calendar_events", "event", "project_id", "project"],
    ["calendar_events", "event", "person_id", "person"],
    ["deep_thoughts", "deep_thought", "project_id", "project"],
    ["nudges", "nudge", "intention_id", "intention"]
  ]) {

    // selectAll, not .limit(MAX_ROWS_PER_TABLE): a bare .limit above 1,000 is
    // silently the 1,000-row cap in no defined order (same bug the text scan
    // was already fixed for), so structural belongs_to edges for the overflow
    // rows would simply never be written while the rebuild reported success.
    const { rows: data, error } = await selectAll(table, `id, ${column}`, {
      max: MAX_ROWS_PER_TABLE,
      modify: q => q.not(column, "is", null).order("id", { ascending: true })
    });

    if (error) console.error(`REBUILD structural scan of ${table}.${column} FAILED — those belongs_to edges not written:`, error.message);

    for (const row of data || []) {
      const made = await link({
        from: { type, id: row.id },
        to: { type: targetType, id: row[column] },
        relation: "belongs_to",
        source: "explicit"
      });
      if (made) created++;
    }

  }


  // Money -> project / person, by merchant name. A charge at a merchant whose
  // name matches a project is the closest thing to an itemised business
  // expense this system can get without being told.
  const txns = await scanTable("transactions", "id, merchant, description, amount, category");

  for (const t of txns) {

    const haystack = `${t.merchant || ""} ${t.description || ""}`;

    for (const hit of await mentionsIn(haystack)) {

      // A charge already carries an explicit `paid_to` edge to its own
      // merchant, written above. Re-linking it as a name it happens to
      // "mention" would be the same fact twice under two relations, and the
      // second one would claim to be evidence of something.
      if (hit.type !== "merchant") {

        const made = await link({
          from: { type: "transaction", id: t.id },
          to: { type: hit.type, id: hit.id },
          relation: "spent_on",
          confidence: hit.confidence ?? 1,
          context: `${t.merchant} ${t.amount}`
        });

        if (made) created++;

      }

    }

  }

  // Last, and only after every write above. Pruning first would delete edges to
  // rows this pass is about to recreate, and pruning concurrently would race
  // them.
  const pruned = await pruneDangling();

  return {
    success: true,
    created,
    pruned,
    merchants: promoted.merchants,
    categories: promoted.categories
  };

}


// ── Detection ────────────────────────────────────────────────────────────
//
// Each of these is a question no single table can answer. All of them are
// computed; none of them are asked of a model.

async function detectFindings(tz) {

  const now = DateTime.now().setZone(tz);

  const findings = [];

  const [people, intentions, projects, txns] = await Promise.all([
    supabase.from("people").select("*").then(r => r.data || []),
    supabase.from("intentions").select("*").eq("status", "open").then(r => r.data || []),
    supabase.from("projects").select("*").then(r => r.data || []),
    supabase.from("transactions").select("*")
      .gte("posted_at", now.minus({ days: 30 }).toISO()).then(r => r.data || [])
  ]);


  // 1. Someone he keeps thinking about but has not contacted. The graph is the
  //    only place this exists: the mentions live in memories and notes, the
  //    silence lives in the people table, and neither knows about the other.
  for (const person of people) {

    const edges = await neighbours({ type: "person", id: person.id });

    const mentions = edges.filter(e => e.relation === "mentions").length;

    if (mentions < 2) continue;

    const days = person.last_contacted_at
      ? Math.floor(now.diff(DateTime.fromISO(person.last_contacted_at), "days").days)
      : null;

    if (days === null || days > 21) {
      findings.push({
        kind: "relationship_debt",
        strength: Math.min(1, mentions / 5),
        fingerprint: `relationship_debt:${person.id}`,
        // The typed entities this finding is ABOUT, as opposed to `facts`,
        // which is what it says. Grouping needs the first and phrasing needs
        // the second, and conflating them is why nothing could previously tell
        // that two findings concerned the same project.
        refs: [{ type: "person", id: String(person.id) }],
        facts: {
          person: person.name,
          mentionedIn: mentions,
          daysSinceContact: days,
          relationship: person.relationship
        }
      });
    }

  }


  // 2. Spending that contradicts a stated intention. Money and intentions have
  //    never been able to see each other at all.
  const spendByCategory = {};

  for (const t of txns) {
    if (Number(t.amount) >= 0 || t.category === "transfers") continue;
    spendByCategory[t.category] = (spendByCategory[t.category] || 0) + Math.abs(Number(t.amount));
  }

  const CONTRADICTIONS = [
    [/\b(lean|weight|lbs|cut|diet|gym|fit)\b/i, "eating out", "eating out"],
    [/\b(save|saving|budget|debt|loan|money|broke|tight)\b/i, "shopping", "discretionary shopping"],
    [/\b(subscription|cancel|spend less)\b/i, "subscriptions", "subscriptions"]
  ];

  for (const intention of intentions) {

    for (const [pattern, category, label] of CONTRADICTIONS) {

      if (!pattern.test(intention.content)) continue;

      const spent = spendByCategory[category] || 0;

      if (spent < 40) continue;

      findings.push({
        kind: "contradiction",
        strength: Math.min(1, spent / 200),
        fingerprint: `contradiction:${intention.id}:${category}`,
        // Two refs, because this finding genuinely is about two things. The
        // category ref is what lets it group with a `concentration` finding
        // about the same spending — "eating out is 45% of your month" and
        // "you said you wanted to cut and spent $180 eating out" are one
        // story, and were being pushed as two notifications.
        refs: [
          { type: "intention", id: String(intention.id) },
          { type: "category", id: category }
        ],
        facts: {
          intention: intention.content,
          category: label,
          spent30d: Math.round(spent * 100) / 100
        }
      });

    }

  }


  // 3. What a project has actually cost, which nothing has ever been able to
  //    total because charges had no owner.
  for (const project of projects) {

    const edges = await neighbours({ type: "project", id: project.id, relation: "spent_on" });

    if (edges.length === 0) continue;

    const ids = edges.map(e => e.from_id);

    const spent = txns
      .filter(t => ids.includes(String(t.id)) && Number(t.amount) < 0)
      .reduce((total, t) => total + Math.abs(Number(t.amount)), 0);

    if (spent < 20) continue;

    findings.push({
      kind: "project_cost",
      strength: 0.6,
      fingerprint: `project_cost:${project.id}:${now.toFormat("yyyy-LL")}`,
      refs: [{ type: "project", id: String(project.id) }],
      facts: { project: project.name, spent30d: Math.round(spent * 100) / 100, charges: ids.length }
    });

  }


  // 4. A single merchant or category swallowing the month.
  const totalSpend = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

  for (const [category, amount] of Object.entries(spendByCategory)) {

    const share = totalSpend > 0 ? amount / totalSpend : 0;

    if (share < 0.45 || amount < 100) continue;

    findings.push({
      kind: "concentration",
      strength: share,
      fingerprint: `concentration:${category}:${now.toFormat("yyyy-LL")}`,
      // A spending category is not a row in any table, so it gets a synthetic
      // ref. It still groups: a concentration in "eating out" and an intention
      // contradicted by "eating out" are the same story told twice.
      refs: [{ type: "category", id: category }],
      facts: {
        category,
        spent30d: Math.round(amount * 100) / 100,
        share: Math.round(share * 100),
        totalSpend: Math.round(totalSpend * 100) / 100
      }
    });

  }


  return findings.sort((a, b) => b.strength - a.strength);

}


// ── Grouping ─────────────────────────────────────────────────────────────
//
// Each detector fires independently and none of them can see the others, so a
// `relationship_debt` and a `project_cost` about the same project arrived as
// two separate notifications about one situation. Getting two buzzes for one
// thing is the fastest way to make someone mute this app, and the interruption
// budget is one message a day — spending it twice on the same story is worse
// than spending it once.
//
// The rule this obeys, and the line it must not cross:
//
//   Grouping findings that share an entity is ARITHMETIC. Two findings either
//   name the same project or they do not, and the graph already says which.
//
//   Deriving one finding FROM another finding's output is NOT, and is
//   forbidden. A chain of inferences starts sounding more certain than any
//   link in it, and the whole "compute in code, model only phrases" discipline
//   is what breaks first. So: group, then phrase once, from the raw facts of
//   every member. Never feed a phrased insight back in as evidence.
//
// Union-find over shared refs, which handles the transitive case — A shares a
// project with B, B shares a category with C, so all three are one story.
export function groupFindings(findings) {

  const parent = findings.map((_, i) => i);

  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const byRef = new Map();

  findings.forEach((finding, index) => {
    for (const ref of finding.refs || []) {
      const key = `${ref.type}:${ref.id}`;
      if (byRef.has(key)) union(byRef.get(key), index);
      else byRef.set(key, index);
    }
  });

  const groups = new Map();

  findings.forEach((finding, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(finding);
  });

  return [...groups.values()].map(members => {

    const sorted = members.slice().sort((a, b) => b.strength - a.strength);

    return {
      members: sorted,
      // The strongest member decides how loudly the group speaks.
      strength: sorted[0].strength,
      kind: sorted.length === 1 ? sorted[0].kind : "synthesis",
      // Composite, and stable regardless of detection order, so the same
      // situation re-detected tomorrow produces the same fingerprint and is
      // recognised as already said.
      fingerprint: sorted.map(f => f.fingerprint).sort().join(" + ")
    };

  }).sort((a, b) => b.strength - a.strength);

}


// ── Surfacing ────────────────────────────────────────────────────────────

const MAX_NEW_INSIGHTS = 3;


export async function findInsights({ deliverImmediately = false } = {}) {

  const tz = await getUserTimezone();

  const findings = await detectFindings(tz);

  if (findings.length === 0) return { success: true, found: 0, written: 0 };

  // Grouped BEFORE the known check, deliberately. Checking first and grouping
  // after would let a group's second member survive on its own the night after
  // the group was raised, and arrive as a separate notification about a
  // situation already described.
  const groups = groupFindings(findings);

  // Both the composite fingerprint and every member's own fingerprint are
  // checked, so a group is recognised as already-said whether it was raised
  // whole or whether one of its members was raised alone before the other
  // appeared.
  const allFingerprints = [
    ...groups.map(g => g.fingerprint),
    ...findings.map(f => f.fingerprint)
  ];

  const { data: existing, error } = await supabase
    .from("insights")
    .select("fingerprint")
    .in("fingerprint", allFingerprints);

  if (error && /schema cache|does not exist/i.test(error.message)) {
    return { success: false, skipped: "insights table not created yet" };
  }

  const known = new Set((existing || []).map(r => r.fingerprint));

  const fresh = groups
    .filter(g => !known.has(g.fingerprint) && !g.members.every(m => known.has(m.fingerprint)))
    .slice(0, MAX_NEW_INSIGHTS);

  if (fresh.length === 0) return { success: true, found: findings.length, groups: groups.length, written: 0 };


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content:
          `Each item below was DETECTED from this person's own data by walking connections ` +
          `between domains that normally cannot see each other — what he writes about, who he ` +
          `contacts, what he spends, what he said he wanted.\n\n` +
          `An item may contain SEVERAL findings. When it does, they were verified to be about ` +
          `the same thing — the same project, person, intention or spending category — and you ` +
          `must write them as ONE observation, not a list. That single sentence is the whole ` +
          `point: each finding on its own is a fact he could have looked up, and putting them ` +
          `side by side is the part he cannot do himself.\n\n` +
          `Write each item as one or two sentences he would actually want to read. Blunt and ` +
          `specific; he has asked never to have things softened. Use the exact figures given ` +
          `and never invent, round or recompute one. Do not hedge about how the findings relate ` +
          `— they were confirmed to share a subject before reaching you.\n\n` +
          `Do not moralise and do not give generic advice. If an item is not genuinely worth ` +
          `interrupting someone for, set worth_saying to false.\n\n` +
          `Return ONLY JSON: {"insights":[{"index":number,"title":"three or four words",` +
          `"body":"","worth_saying":boolean}]}`
      },
      {
        role: "user",
        content: JSON.stringify(
          fresh.map((group, i) => ({
            index: i,
            findings: group.members.map(m => ({ kind: m.kind, facts: m.facts }))
          })),
          null,
          1
        )
      }
    ]

  });


  let phrased = [];

  try {
    phrased = JSON.parse(response.choices[0].message.content).insights || [];
  } catch {
    return { success: false, error: "could not read the phrasing back" };
  }


  const now = DateTime.now().setZone(tz);

  const rows = phrased
    .filter(p => p.worth_saying && fresh[p.index])
    .map(p => ({
      fingerprint: fresh[p.index].fingerprint,
      kind: fresh[p.index].kind,
      title: p.title || "Noticed",
      body: p.body,
      // Every member's facts, so the evidence behind a synthesised insight is
      // recoverable rather than living only in the sentence it produced.
      entities: {
        findings: fresh[p.index].members.map(m => ({ kind: m.kind, facts: m.facts })),
        refs: fresh[p.index].members.flatMap(m => m.refs || [])
      },
      strength: fresh[p.index].strength,
      status: "new",
      // Insights ride the same spread-through-the-day delivery as nudges, so
      // they cannot re-create the morning pile-up that made this app feel like
      // a daily dump rather than something present.
      deliver_at: deliverImmediately ? null : now.set({ hour: 16, minute: 0 }).toISO()
    }));

  if (rows.length === 0) return { success: true, found: findings.length, groups: groups.length, written: 0 };

  const { error: writeError } = await supabase.from("insights").upsert(rows, { onConflict: "fingerprint" });

  if (writeError) throw new Error(writeError.message);

  return {
    success: true,
    found: findings.length,
    groups: groups.length,
    merged: rows.filter(r => r.kind === "synthesis").length,
    written: rows.length,
    insights: rows.map(r => r.title)
  };

}


// Delivery, on the same cron slots as nudges.
export async function deliverInsights() {

  const { sendPush } = await import("../lib/push.js");
  const { pushAllowed } = await import("../lib/settings.js");

  const { data, error } = await supabase
    .from("insights")
    .select("id, title, body")
    .is("pushed_at", null)
    // Only what is still outstanding.
    //
    // This filter was not here and did not need to be, because until insights
    // had a surface there was no way to answer one before it was pushed —
    // `status` was written once and never changed. Now that the dashboard can
    // clear an insight, and two of the three on file are sitting with
    // pushed_at null, without this a finding dismissed at noon would still
    // buzz the phone at four. Reading something and then being notified about
    // it is precisely the noise the interruption budget exists to prevent.
    .eq("status", "new")
    .not("deliver_at", "is", null)
    .lte("deliver_at", new Date().toISOString())
    .order("strength", { ascending: false })
    .limit(1);

  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) return { success: true, skipped: "not created yet" };
    throw new Error(error.message);
  }

  let delivered = 0;

  for (const insight of data || []) {

    if (await pushAllowed("insight")) {
      const result = await sendPush({
        title: insight.title || "Noticed",
        body: insight.body,
        url: "/",
        tag: `insight-${insight.id}`
      }).catch(() => ({ sent: 0 }));
      if (result?.sent > 0) delivered++;
    }

    await supabase.from("insights").update({ pushed_at: new Date().toISOString() }).eq("id", insight.id);

  }

  return { success: true, delivered, considered: (data || []).length };

}


// What every reasoning tool should know. This is the part that makes it a
// hivemind rather than a notification feed: an insight raised last week is
// context for a deep thought today, a project plan tomorrow and every brief in
// between, rather than something that flashed on a phone once.
export async function recentInsights({ limit = 5 } = {}) {

  const { data, error } = await supabase
    .from("insights")
    .select("kind, title, body, created_at")
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(limit);

  // Loud, not swallowed. This rides inside buildRichContext() into ten
  // reasoning tools, so a broken query here silently drops insights from every
  // one of them — the exact shape of the projectSignal bug that was dead from
  // birth. The null return stays (one bad query must not take down a brief);
  // what changes is that it can no longer be mistaken for "no insights yet".
  if (error) {
    console.error("recentInsights QUERY FAILED — insights silently absent from every reasoning call until fixed:", error.message);
    return null;
  }

  if (!data || data.length === 0) return null;

  return data.map(i => `- ${i.title}: ${i.body}`).join("\n");

}


// Insights the user has not seen yet, for the dashboard.
//
// Until now an insight existed ONLY as a push notification. If the phone was
// silent — which it is at every interruption level below "everything", where
// insights are tiered — or if the notification was swiped away, the finding
// was gone: nothing listed it, no page showed it, and the only trace was a row
// nobody could reach. Three insights had been sitting undelivered and
// unseeable when this was written.
//
// The same posture the observer already takes with prompts: the row is written
// regardless of whether the phone is allowed to buzz, because muting should
// mean "stop interrupting me", not "stop telling me".
export async function pendingInsights({ limit = 10 } = {}) {

  const { data, error } = await supabase
    .from("insights")
    .select("id, kind, title, body, strength, created_at, pushed_at")
    .eq("status", "new")
    .order("strength", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("pendingInsights QUERY FAILED — the dashboard's insight queue silently shows nothing until fixed:", error.message);
    return [];
  }

  return data || [];

}


// The user did something about an insight, or decided not to.
//
// `acted_on` has existed as a column since the graph shipped and nothing has
// ever set it, so there has never been any signal about which kinds of finding
// are worth making. Four detectors fire blind and always will until something
// records whether anyone cared. This is the minimum version of that: an
// explicit answer from the person it was about.
export async function resolveInsight({ id, acted = false }) {

  // Reported rather than thrown, and rather than ignored.
  //
  // Thrown, a bad id takes down the whole dashboard — there is no error.js
  // anywhere in this app, so any throw out of a server action becomes Next's
  // "This page couldn't load" over the entire page, for a button that clears
  // one card. Ignored, it becomes trap #15: a write that silently did nothing
  // while the UI cheerfully moved on. So the result is returned, and the
  // caller can decide.
  const { data, error } = await supabase
    .from("insights")
    .update({
      status: acted ? "acted" : "dismissed",
      acted_on: acted === true
    })
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("INSIGHT RESOLVE FAILED:", error.message);
    return { success: false, error: error.message };
  }

  // An update that matched nothing is not a success. PostgREST reports zero
  // affected rows as an empty array and no error, so without this a stale id
  // from a page that had not refreshed would look like it worked.
  if (!data || data.length === 0) {
    return { success: false, error: "That insight no longer exists." };
  }

  return { success: true, message: acted ? "Noted — marked as acted on." : "Dismissed." };

}
