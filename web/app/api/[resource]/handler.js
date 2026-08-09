import supabase from "../../../lib/supabase.js";
import { requireAuth } from "../../../lib/auth.js";
import { getMemories, deleteMemory } from "../../../tools/memory.js";
import { answerPlaceLabel } from "../../../tools/location.js";
import {
  getRecentNotes, deleteNote, getAllIntentions, deleteIntention,
  getHistory,
  getPendingNudges, resolveNudge,
  getProjectsWithDetails, updateProject,
  getPendingDeepThoughts, resolveDeepThought, getThreadTurns, updateDeepThoughtThread,
  getMostRecentBrief, getLatestUnreadBrief, markBriefRead
} from "../../../tools/database.js";
import { deleteProject } from "../../../tools/projects.js";
import { PLAN_TOOLS } from "../../../lib/planTools.js";
import { getSettings, saveSettings, INTERRUPTION_LEVELS } from "../../../lib/settings.js";
import { buildDiagnostics } from "../../../lib/diagnostics.js";
import { sendPush } from "../../../lib/push.js";
import { getNewsFeed, syncNewsDigest, deleteNewsItem } from "../../../tools/news.js";
import { startDebateSession, respondInDebate, endDebateSession } from "../../../tools/debate.js";
import { submitPitch, generatePitchTopic, transcribeAudio } from "../../../tools/pitch.js";
import { getDebateTopics, ensureTopicsFramed, retireDebateTopic } from "../../../tools/debateTopics.js";
import { savePerson, getAllPeople, deletePerson, recordContact, answerRelationshipCheckin } from "../../../tools/people.js";
import { loadMoney } from "../../../lib/money.js";
import { summarise, findRecurring, FINANCE_RANGES } from "../../../lib/categorize.js";
import { queryFinances } from "../../../tools/finances.js";
import { pendingInsights, resolveInsight } from "../../../tools/islands.js";


// Every read/write endpoint the dashboard uses, behind ONE serverless function.
//
// Vercel Hobby allows 12 functions per deployment and this project sat at 11,
// which is what blocked every new integration. Five separate files —
// /api/data, /api/history, /api/projects, /api/nudges, /api/deepThoughts —
// were each a whole function to do a few Supabase reads. A dynamic segment
// counts as one function while still matching all five paths, so **no public
// URL changed**: the iOS Shortcut and the web dashboard call exactly what they
// called before. /api/brief/latest is two segments so it can't match here; a
// rewrite in vercel.json maps it onto `brief` below.
//
// Explicit files still win over a dynamic segment, so /api/capture is
// unaffected by this route existing — but that's worth re-testing after any
// change here, because it is the spine of the whole system.


async function data(req, res) {

  if (req.method === "GET") {

    // Prompts are what the app raised on its own — a place to name, a daily
    // observation.
    if (req.query.prompts) {

      // Insights come back alongside prompts rather than on their own route.
      // They are the same thing from the user's side — something the app
      // raised on its own that is waiting for them — and until now an insight
      // had no surface at all: it existed only as a push, so a swiped
      // notification meant the finding was gone for good.
      const [{ data, error }, insights] = await Promise.all([
        supabase
          .from("prompts")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(20),
        pendingInsights({ limit: 10 }).catch(() => [])
      ]);

      if (error) throw new Error(error.message);

      return res.status(200).json({
        success: true,
        prompts: data || [],
        // Shaped like a prompt so the dashboard renders them with the same
        // card, but kept under their own key so the two can never be confused
        // when one is answered.
        insights: insights.map(i => ({
          id: i.id,
          kind: "insight",
          title: i.title,
          body: i.body,
          created_at: i.created_at,
          seen: Boolean(i.pushed_at)
        }))
      });

    }

    const [memories, notes, intentions] = await Promise.all([
      getMemories(200),
      getRecentNotes({ limit: 200 }),
      getAllIntentions()
    ]);

    return res.status(200).json({ success: true, memories, notes, intentions });

  }


  if (req.method === "POST") {

    const { type, id, answer } = req.body || {};

    if (!type || !id) {
      return res.status(400).json({ error: "Missing type or id" });
    }

    if (type === "insight") {

      // "acted" is the only answer that means anything beyond clearing it —
      // it is the first and currently only signal this system has about which
      // kinds of finding were worth making.
      return res.status(200).json(await resolveInsight({ id, acted: answer === "acted" }));

    }

    if (type === "prompt") {

      const { data: prompt } = await supabase
        .from("prompts").select("kind, payload").eq("id", id).single();

      if (prompt?.kind === "label_place" && answer && answer !== "dismissed") {
        return res.status(200).json(await answerPlaceLabel({ prompt_id: id, answer }));
      }

      if (prompt?.kind === "relationship_checkin") {
        return res.status(200).json(await answerRelationshipCheckin({
          prompt_id: id,
          person_id: prompt.payload?.person_id,
          answer
        }));
      }

      await supabase
        .from("prompts")
        .update({ status: "answered", answer: answer || "dismissed", answered_at: new Date().toISOString() })
        .eq("id", id);

      return res.status(200).json({ success: true });

    }

    if (type === "memory") {
      await deleteMemory(id);
    } else if (type === "note") {
      await deleteNote(id);
    } else if (type === "intention") {
      await deleteIntention(id);
    } else {
      return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    return res.status(200).json({ success: true });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function history(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({ success: true, ...(await getHistory()) });

}


async function nudges(req, res) {

  if (req.method === "GET") {
    return res.status(200).json({ success: true, nudges: await getPendingNudges() });
  }

  if (req.method === "POST") {

    const { id } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing id" });

    await resolveNudge(id);

    return res.status(200).json({ success: true });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function projects(req, res) {

  if (req.method === "GET") {
    const status = req.query.status === "archived" ? "archived" : "active";
    return res.status(200).json({ success: true, projects: await getProjectsWithDetails({ status }) });
  }

  if (req.method === "POST") {

    const { id, action, status, next_action } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing id" });

    if (action === "delete") {
      return res.status(200).json(await deleteProject({ project_id: id }));
    }

    await updateProject({ id, status, next_action });

    return res.status(200).json({ success: true });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function deepThoughts(req, res) {

  if (req.method === "GET") {

    if (req.query.turns) {
      return res.status(200).json({ success: true, turns: await getThreadTurns(req.query.turns) });
    }

    // The toggle list is served rather than duplicated in the frontend, so
    // adding a capability doesn't need a matching edit in the dashboard.
    return res.status(200).json({
      success: true,
      thoughts: await getPendingDeepThoughts(),
      planTools: PLAN_TOOLS
    });

  }


  if (req.method === "POST") {

    const { action, id, message } = req.body || {};


    if (!action || action === "resolve") {

      if (!id) return res.status(400).json({ error: "Missing id" });

      await resolveDeepThought(id);

      return res.status(200).json({ success: true });

    }


    if (action === "respond") {

      if (!id || !message) return res.status(400).json({ error: "Missing id or message" });

      // Dynamic import, not a top-of-file one: thread.js pulls in gmail.js and
      // googleDocs.js, which pull in the googleapis SDK — by far the heaviest
      // dependency in this function. Loading it eagerly meant every dashboard
      // read (nudges, projects, settings...) paid that cold-start cost too,
      // since they all share this one file. Now only an actual thread action does.
      const { respondToThread } = await import("../../../tools/thread.js");

      return res.status(200).json(await respondToThread({ deep_thought_id: id, message }));

    }


    if (action === "buildPlan") {

      if (!id) return res.status(400).json({ error: "Missing id" });

      const { buildPlan } = await import("../../../tools/thread.js");

      return res.status(200).json(await buildPlan({
        deep_thought_id: id,
        tools: req.body?.tools ?? null
      }));

    }


    // Speech for a thread reply. Same transcription path the pitch recorder
    // uses — better punctuation than iOS dictation, and it doesn't give up
    // when you pause mid-thought, which is most of what happens here.
    if (action === "transcribe") {

      return res.status(200).json(await transcribeAudio({
        audio_base64: req.body?.audio_base64,
        mime_type: req.body?.mime_type
      }));

    }


    // Escape hatch. The build runs in the background, so if the function is
    // killed mid-flight the thread would sit in "building" forever with the
    // rebuild guard blocking any retry. This lets the dashboard hand it back.
    if (action === "resetBuild") {

      if (!id) return res.status(400).json({ error: "Missing id" });

      await updateDeepThoughtThread({ id, thread_status: "ready_to_build" });

      return res.status(200).json({ success: true });

    }


    return res.status(400).json({ error: `Unknown action: ${action}` });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function brief(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // peek=true: for the dashboard, which may be revisited — shows the latest
  // brief without consuming it. Default (Shortcuts): only unread briefs,
  // marked read once delivered.
  const peek = req.query.peek === "true";

  const found = peek ? await getMostRecentBrief() : await getLatestUnreadBrief();

  if (!found) {
    return res.status(200).json({ success: true, hasBrief: false, message: "No new brief available." });
  }

  if (!peek) await markBriefRead(found.id);

  return res.status(200).json({
    success: true,
    hasBrief: true,
    content: found.content,
    created_at: found.created_at
  });

}


async function settings(req, res) {

  if (req.method === "GET") {
    return res.status(200).json({ success: true, settings: await getSettings(), levels: INTERRUPTION_LEVELS });
  }

  if (req.method === "POST") {

    const patch = req.body || {};

    if (patch.interruption_level && !INTERRUPTION_LEVELS.includes(patch.interruption_level)) {
      return res.status(400).json({ error: `Unknown interruption level: ${patch.interruption_level}` });
    }

    const result = await saveSettings(patch);

    return res.status(result.success ? 200 : 200).json({ ...result, settings: await getSettings() });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function diag(req, res) {

  if (req.method === "GET") {
    return res.status(200).json(await buildDiagnostics());
  }

  // A test push belongs here rather than anywhere else: the honest question is
  // "does a notification actually arrive on the phone", and no amount of
  // reading the database answers it. Bypasses the interruption level on
  // purpose — it was explicitly asked for.
  if (req.method === "POST" && req.body?.action === "testPush") {

    const result = await sendPush({
      title: "PersonalOS",
      body: "Test notification — push is working.",
      url: "/settings",
      tag: "test"
    });

    return res.status(200).json({ success: true, ...result });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function practice(req, res) {

  if (req.method === "GET") {

    // Tops up the evergreen topic deck. Idempotent by slug, so calling it
    // repeatedly is safe — it only frames seeds that aren't framed yet.
    if (req.query.syncTopics) {
      return res.status(200).json(await ensureTopicsFramed());
    }

    if (req.query.sessions) {

      const { data, error } = await supabase
        .from("practice_sessions")
        .select("id, type, topic, user_side, feedback, status, created_at, completed_at, news_items(headline)")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw new Error(error.message);

      return res.status(200).json({ success: true, sessions: data || [] });

    }

    if (req.query.session) {

      const { data, error } = await supabase
        .from("practice_sessions")
        .select("*, news_items(headline, tension, side_a, side_b), debate_topics(title, tension, side_a, side_b)")
        .eq("id", req.query.session)
        .single();

      if (error) throw new Error(error.message);

      return res.status(200).json({ success: true, session: data });

    }

    // The deck the Practice tab argues from. Evergreen topics now, not the
    // morning's news — see tools/debateTopics.js for why.
    return res.status(200).json({ success: true, topics: await getDebateTopics() });

  }

  if (req.method === "POST") {

    const { action } = req.body || {};

    if (action === "startDebate") {
      return res.status(200).json(await startDebateSession(req.body));
    }

    if (action === "respondDebate") {
      return res.status(200).json(await respondInDebate(req.body));
    }

    if (action === "endDebate") {
      return res.status(200).json(await endDebateSession(req.body));
    }

    if (action === "submitPitch") {
      return res.status(200).json(await submitPitch(req.body));
    }

    if (action === "generateTopic") {
      return res.status(200).json(await generatePitchTopic());
    }

    if (action === "retireTopic") {
      return res.status(200).json(await retireDebateTopic(req.body?.topic_id));
    }

    if (action === "deleteNews") {
      return res.status(200).json(await deleteNewsItem(req.body?.news_item_id));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


// The news reader, split out from Practice. Practice argues evergreen topics;
// this is for actually following what happened, ordered by what matters to him
// rather than by what a wire service ran most recently.
async function news(req, res) {

  if (req.method === "GET") {

    // Manual refresh — same function the daily cron calls, exposed so a real
    // feed exists to read without waiting for tomorrow morning.
    if (req.query.sync) {
      return res.status(200).json(await syncNewsDigest());
    }

    return res.status(200).json({ success: true, items: await getNewsFeed() });

  }

  if (req.method === "POST") {

    const { action, news_item_id } = req.body || {};

    if (action === "delete") {
      return res.status(200).json(await deleteNewsItem(news_item_id));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function people(req, res) {

  if (req.method === "GET") {
    return res.status(200).json({ success: true, people: await getAllPeople() });
  }

  if (req.method === "POST") {

    const { action, id, name } = req.body || {};

    if (action === "delete") {

      if (!id) return res.status(400).json({ error: "Missing id" });

      return res.status(200).json(await deletePerson(id));

    }

    if (action === "logContact") {

      if (!name) return res.status(400).json({ error: "Missing name" });

      return res.status(200).json(await recordContact({ name }));

    }

    // Default: create or update by name.
    return res.status(200).json(await savePerson(req.body || {}));

  }

  return res.status(405).json({ error: "Method not allowed" });

}


async function finance(req, res) {

  // The in-app "ask it a financial question" box and the Shortcut's
  // query_finances tool call the exact same function — one router entry, so
  // the two can never quietly drift into answering differently.
  if (req.method === "POST") {

    const { question, days } = req.body || {};

    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, error: "Ask it something first." });
    }

    const result = await queryFinances({ question, days: Math.min(Number(days) || 30, 90) });

    return res.status(200).json(result);

  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Every range is computed in one request, and the page switches between them
  // without coming back here.
  //
  // It used to fetch per range, and that was slow for a reason worth writing
  // down. The bank call itself was never the problem — lib/simplefin.js caches
  // a 100-day window for 12h, so a range change was already only a re-slice.
  // The cost was categorisation: merchants that no rule matches are classified
  // by a model, and that answer is memoised only in module scope, so it lives
  // and dies with the serverless container. Switching to a wider range surfaces
  // merchants the narrower one never contained, so each switch could hit a
  // fresh model call on a cold container.
  //
  // Categorising the widest window once and slicing it three ways removes that
  // entirely: strictly fewer model calls than before, and switching becomes
  // local state rather than a round trip.
  const WIDEST = Math.max(...FINANCE_RANGES);

  // classifyUnknown: this is the one caller that pays for the model pass. The
  // breakdown IS the page, and the answer is memoised per merchant for the life
  // of the container. lib/money.js explains why the cheaper rules-only mode
  // used everywhere else still produces identical totals.
  const raw = await loadMoney({ days: WIDEST, classifyUnknown: true });

  const accounts = raw.accounts.map(a => ({
    name: a.name,
    balance: a.balance,
    currency: a.currency
  }));

  const transactions = raw.transactions;

  // Dates are compared as yyyy-MM-dd strings rather than instants, the same
  // rule trap #1 established for Google Tasks — a transaction dated today must
  // not fall out of the 7-day window because of a timezone offset.
  // lib/simplefin.js hands back `date` as a real Date object, and every date
  // leaving this handler has to be a yyyy-MM-dd string before it does. Not for
  // tidiness: the dashboard calls this function in-process (app/backend.js), so
  // there is no JSON serialisation between here and the page to stringify a
  // Date on the way. `recent` used to pass `t.date` straight through, which
  // rendered as the raw ISO string back when the dashboard still fetched over
  // HTTP and became "Objects are not valid as a React child" the moment that
  // hop was removed — the whole money page, on Next's built-in error screen.
  const dayKey = (value) => new Date(value).toISOString().slice(0, 10);

  const cutoffs = {};
  const views = {};

  for (const range of FINANCE_RANGES) {

    const cutoff = new Date(Date.now() - range * 86400_000).toISOString().slice(0, 10);

    cutoffs[range] = cutoff;

    const slice = transactions.filter(t => dayKey(t.date) >= cutoff);

    views[range] = {
      ...summarise(slice),
      recurring: findRecurring(slice),
      recent: slice
        .filter(t => t.category !== "transfers")
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 12)
        .map(t => ({ date: dayKey(t.date), merchant: t.merchant, amount: Number(t.amount), category: t.category }))
    };

  }

  return res.status(200).json({
    success: true,
    ranges: FINANCE_RANGES,
    cached: raw.cached,
    fetchedAt: raw.fetchedAt,
    accounts,
    totalBalance: raw.balance,
    cutoffs,
    views,
    // The whole categorised window, newest first, for the per-category
    // drilldown. Sent once rather than per range because the page filters it
    // by category and cutoff locally — filtering a list is not arithmetic, and
    // the figures above it are still the ones computed here.
    transactions: transactions
      .filter(t => t.category !== "transfers")
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 600)
      .map(t => ({ date: dayKey(t.date), merchant: t.merchant, amount: Number(t.amount), category: t.category }))
  });

}


const RESOURCES = { data, history, nudges, projects, deepThoughts, brief, settings, diag, practice, people, news, finance };


export default async function handler(req, res) {

  if (!requireAuth(req, res)) return;

  const run = RESOURCES[req.query.resource];

  if (!run) {
    return res.status(404).json({ error: `Unknown resource: ${req.query.resource}` });
  }

  try {

    return await run(req, res);

  } catch (error) {

    console.error(`RESOURCE ${req.query.resource} FAILED:`, error.message);

    return res.status(500).json({ error: error.message });

  }

}
