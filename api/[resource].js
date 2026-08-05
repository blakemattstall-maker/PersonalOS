import supabase from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { getMemories, deleteMemory } from "../tools/memory.js";
import { answerPlaceLabel } from "../tools/location.js";
import {
  getRecentNotes, deleteNote, getAllIntentions, deleteIntention,
  getHistory,
  getPendingNudges, resolveNudge,
  getProjectsWithDetails, updateProject,
  getPendingDeepThoughts, resolveDeepThought, getThreadTurns, updateDeepThoughtThread,
  getMostRecentBrief, getLatestUnreadBrief, markBriefRead
} from "../tools/database.js";
import { deleteProject } from "../tools/projects.js";
import { respondToThread, buildPlan } from "../tools/thread.js";
import { getSettings, saveSettings, INTERRUPTION_LEVELS } from "../lib/settings.js";
import { buildDiagnostics } from "../lib/diagnostics.js";
import { sendPush } from "../lib/push.js";
import { getTodaysDigest, syncNewsDigest, deleteNewsItem } from "../tools/news.js";
import { startDebateSession, respondInDebate, endDebateSession } from "../tools/debate.js";
import { submitPitch } from "../tools/pitch.js";


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

      const { data, error } = await supabase
        .from("prompts")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw new Error(error.message);

      return res.status(200).json({ success: true, prompts: data || [] });

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

    if (type === "prompt") {

      const { data: prompt } = await supabase
        .from("prompts").select("kind").eq("id", id).single();

      if (prompt?.kind === "label_place" && answer && answer !== "dismissed") {
        return res.status(200).json(await answerPlaceLabel({ prompt_id: id, answer }));
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
    return res.status(200).json({ success: true, projects: await getProjectsWithDetails() });
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

    return res.status(200).json({ success: true, thoughts: await getPendingDeepThoughts() });

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

      return res.status(200).json(await respondToThread({ deep_thought_id: id, message }));

    }


    if (action === "buildPlan") {

      if (!id) return res.status(400).json({ error: "Missing id" });

      return res.status(200).json(await buildPlan({ deep_thought_id: id }));

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

    // Manual refresh from the dashboard — same function the daily cron calls,
    // exposed here so a real digest exists to test/demo without waiting for
    // the next scheduled run.
    if (req.query.sync) {
      return res.status(200).json(await syncNewsDigest());
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
        .select("*, news_items(headline, tension, side_a, side_b)")
        .eq("id", req.query.session)
        .single();

      if (error) throw new Error(error.message);

      return res.status(200).json({ success: true, session: data });

    }

    return res.status(200).json({ success: true, digest: await getTodaysDigest() });

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

    if (action === "deleteNews") {
      return res.status(200).json(await deleteNewsItem(req.body?.news_item_id));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  }

  return res.status(405).json({ error: "Method not allowed" });

}


const RESOURCES = { data, history, nudges, projects, deepThoughts, brief, settings, diag, practice };


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
