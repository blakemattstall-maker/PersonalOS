import supabase from "../lib/supabase.js";
import openai from "../lib/openai.js";
import { MODELS } from "../lib/models.js";
import { DateTime } from "luxon";
import { link, findMentions, loadEntities, neighbours, linksReady } from "../lib/links.js";
import { getUserTimezone } from "../lib/profile.js";
import { getFinancialData } from "../lib/simplefin.js";
import { categorizeTransactions, classifyUnknownMerchants } from "../lib/categorize.js";


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

  const raw = await getFinancialData({ days });

  const incoming = (raw.accounts || []).flatMap(a =>
    (a.transactions || []).map(t => ({ ...t, account: a.name }))
  );

  if (incoming.length === 0) return { success: true, stored: 0 };

  const { transactions } = await categorizeTransactions(incoming, {
    classifyUnknown: classifyUnknownMerchants
  });

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


export async function rebuildLinks() {

  if (!(await linksReady())) {
    return { success: false, skipped: "entity_links table not created yet" };
  }

  const entities = await loadEntities();

  let created = 0;

  // Text -> person / project / place, by name.
  for (const source of TEXT_SOURCES) {

    const { data, error } = await supabase
      .from(source.table)
      .select(`id, ${source.field}`)
      .limit(500);

    if (error) continue;

    for (const row of data || []) {

      const text = row[source.field];

      for (const [entityType, roster] of Object.entries(entities)) {

        for (const hit of findMentions(text, roster)) {

          const made = await link({
            from: { type: source.type, id: row.id },
            to: { type: entityType, id: hit.id },
            relation: "mentions",
            confidence: hit.confidence ?? 1,
            context: text
          });

          if (made) created++;

        }

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

    const { data } = await supabase.from(table).select(`id, ${column}`).not(column, "is", null).limit(500);

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
  const { data: txns } = await supabase
    .from("transactions")
    .select("id, merchant, description, amount, category")
    .limit(500);

  for (const t of txns || []) {

    const haystack = `${t.merchant || ""} ${t.description || ""}`;

    for (const [entityType, roster] of Object.entries(entities)) {

      for (const hit of findMentions(haystack, roster)) {

        const made = await link({
          from: { type: "transaction", id: t.id },
          to: { type: entityType, id: hit.id },
          relation: "spent_on",
          confidence: hit.confidence ?? 1,
          context: `${t.merchant} ${t.amount}`
        });

        if (made) created++;

      }

    }

  }

  return { success: true, created };

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


// ── Surfacing ────────────────────────────────────────────────────────────

const MAX_NEW_INSIGHTS = 3;


export async function findInsights({ deliverImmediately = false } = {}) {

  const tz = await getUserTimezone();

  const findings = await detectFindings(tz);

  if (findings.length === 0) return { success: true, found: 0, written: 0 };

  // Already-known findings are dropped before anything is phrased, so a
  // standing situation costs nothing to re-detect every night.
  const { data: existing, error } = await supabase
    .from("insights")
    .select("fingerprint")
    .in("fingerprint", findings.map(f => f.fingerprint));

  if (error && /schema cache|does not exist/i.test(error.message)) {
    return { success: false, skipped: "insights table not created yet" };
  }

  const known = new Set((existing || []).map(r => r.fingerprint));

  const fresh = findings.filter(f => !known.has(f.fingerprint)).slice(0, MAX_NEW_INSIGHTS);

  if (fresh.length === 0) return { success: true, found: findings.length, written: 0 };


  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content:
          `Each finding below was DETECTED from this person's own data by walking connections ` +
          `between domains that normally cannot see each other — what he writes about, who he ` +
          `contacts, what he spends, what he said he wanted.\n\n` +
          `Write each one as one or two sentences he would actually want to read. Blunt and ` +
          `specific; he has asked never to have things softened. Use the exact figures given ` +
          `and never invent, round or recompute one. Say the connection plainly — the value is ` +
          `that these two facts had never been put side by side.\n\n` +
          `Do not moralise and do not give generic advice. If a finding is not genuinely worth ` +
          `interrupting someone for, set worth_saying to false.\n\n` +
          `Return ONLY JSON: {"insights":[{"index":number,"title":"three or four words",` +
          `"body":"","worth_saying":boolean}]}`
      },
      { role: "user", content: JSON.stringify(fresh.map((f, i) => ({ index: i, kind: f.kind, facts: f.facts })), null, 1) }
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
      entities: fresh[p.index].facts,
      strength: fresh[p.index].strength,
      status: "new",
      // Insights ride the same spread-through-the-day delivery as nudges, so
      // they cannot re-create the morning pile-up that made this app feel like
      // a daily dump rather than something present.
      deliver_at: deliverImmediately ? null : now.set({ hour: 16, minute: 0 }).toISO()
    }));

  if (rows.length === 0) return { success: true, found: findings.length, written: 0 };

  const { error: writeError } = await supabase.from("insights").upsert(rows, { onConflict: "fingerprint" });

  if (writeError) throw new Error(writeError.message);

  return { success: true, found: findings.length, written: rows.length, insights: rows.map(r => r.title) };

}


// Delivery, on the same cron slots as nudges.
export async function deliverInsights() {

  const { sendPush } = await import("../lib/push.js");
  const { pushAllowed } = await import("../lib/settings.js");

  const { data, error } = await supabase
    .from("insights")
    .select("id, title, body")
    .is("pushed_at", null)
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
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return null;

  if (!data || data.length === 0) return null;

  return data.map(i => `- ${i.title}: ${i.body}`).join("\n");

}
