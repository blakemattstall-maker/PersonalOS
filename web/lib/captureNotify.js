import { sendPush } from "./push.js";
import { pushAllowed } from "./settings.js";


// What a capture tells you afterwards.
//
// The Shortcut used to end in its own notification showing the raw body of the
// HTTP response — the shortcut's name and a blob of JSON. That confirmed the
// request arrived and almost nothing else: it could not say what was created,
// it could not link to it, and for a question it showed the answer wrapped in
// braces. The Shortcut is silent now and this replaces it.
//
// Which makes this load-bearing rather than decorative. With the Shortcut
// silent, this notification is the ONLY reply to a capture — including when the
// capture was a question, and including when it failed. Anything that returns
// early without notifying leaves him talking to something that never answers.


// The web dashboard, for deep links back into the app. Notification targets are
// resolved by the service worker against the app's own origin, so a relative
// path is correct here and stays correct if the domain ever changes.
const PAGE_FOR_TOOL = {
  create_task: "/",
  create_event: "/",
  modify_task: "/",
  modify_event: "/",
  query_schedule: "/",
  query_tasks: "/",
  query_projects: "/",
  query_connections: "/graph",
  save_note: "/data",
  save_memory: "/data",
  save_intention: "/data",
  query_notes: "/data",
  save_person: "/people",
  query_people: "/people",
  record_contact: "/people",
  review_inbox: "/",
  start_deep_thinking: "/",
  log_bodyweight: "/",
  query_finances: "/"
};


// Short label for the notification title. The body carries the detail, so this
// only has to say what kind of thing just happened.
const TITLE_FOR_TOOL = {
  create_task: "Task added",
  create_event: "Event created",
  modify_task: "Task updated",
  modify_event: "Event moved",
  save_note: "Noted",
  save_memory: "Saved",
  save_intention: "Saved",
  save_person: "Person saved",
  record_contact: "Contact logged",
  draft_email: "Draft ready",
  export_to_doc: "Doc created",
  start_deep_thinking: "Thinking it through",
  review_inbox: "Inbox",
  log_bodyweight: "Weight logged",
  research_query: "Looked it up",
  general_question: "Answer",
  clarification: "Done",
  // Questions need a title as much as actions do — more, arguably, since the
  // body is the whole answer and the title is the only thing visible before he
  // opens it. Without these they fell through to a bare "PersonalOS".
  query_schedule: "Your schedule",
  query_tasks: "Your tasks",
  query_notes: "Your notes",
  query_projects: "Your projects",
  query_finances: "Your money",
  query_people: "People",
  query_connections: "Connections"
};


// iOS shows roughly two lines collapsed and expands on a long press, so this is
// generous rather than tight — truncating a question's answer to a headline
// would make the notification useless for exactly the captures where it is the
// only reply.
const MAX_BODY = 320;


function truncate(text, limit = MAX_BODY) {

  const clean = String(text || "").replace(/\s+/g, " ").trim();

  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;

}


// Tools whose output only exists outside this app. A Gmail draft and an
// exported Doc have no in-app view at all, so the external URL is the only
// useful destination for those two — and nothing else.
const EXTERNAL_IS_THE_POINT = new Set(["draft_email", "export_to_doc"]);


// The app first, deliberately, and this is a correction rather than a
// preference.
//
// This used to prefer the artefact's own URL, which for a calendar event meant
// Google's `htmlLink`. Tapping that from the installed PWA opens it in a
// browser with no Google session, so instead of the event you land on a signed
// out Google Calendar marketing page — reported from a real capture. The
// artefact link is worse than useless there: it is a dead end that looks like
// a broken app.
//
// So an in-app page wins whenever one exists. It always opens, it always shows
// the change, and the service worker can reuse the already-open window for it.
function linkFor(entry) {

  const tool = entry?.tool;

  const page = PAGE_FOR_TOOL[tool];

  if (page) return page;

  if (EXTERNAL_IS_THE_POINT.has(tool)) {

    const data = entry?.result?.data;

    if (data?.url) return data.url;

  }

  return "/";

}


export function describeCapture(results = [], heard = null) {

  if (!Array.isArray(results) || results.length === 0) return null;


  const failures = results.filter(r => r.error || r.result?.success === false);

  const spoken = results
    .map(r => r.result?.message || (r.error ? `That failed: ${r.error}` : null))
    .filter(Boolean)
    .map(m => /[.!?]$/.test(m.trim()) ? m.trim() : `${m.trim()}.`)
    .join(" ");


  // A failure has to be unmistakable. The old Shortcut notification at least
  // put the raw error on screen; silence plus a cheerful title would be worse
  // than what it replaced.
  if (failures.length === results.length) {

    return {
      title: "Didn't work",
      body: truncate(spoken || "That capture failed.") + (heard ? ` — heard: "${truncate(heard, 60)}"` : ""),
      url: "/",
      tag: `capture-${Date.now()}`
    };

  }


  const first = results.find(r => !r.error && r.result?.success !== false) || results[0];

  const title = results.length > 1
    ? `${results.length} things done`
    : (TITLE_FOR_TOOL[first?.tool] || "Almanac");

  return {

    title: failures.length > 0 ? `${title} (1 failed)` : title,

    body: truncate(spoken),

    url: linkFor(first),

    // Unique per capture on purpose. The digest uses a stable tag so a new one
    // replaces the last, which is right for a once-a-day summary and wrong
    // here — three captures in a row are three separate things he did, and
    // collapsing them would hide two of them.
    tag: `capture-${Date.now()}`

  };

}


// A push body is truncated by every platform and gone once swiped, so any
// answer worth reading twice also needs somewhere to live.
//
// The no-tool-call branch of the capture handler already files its reply as a
// prompt; answers that came from a TOOL did not, which is precisely backwards
// — those are the long ones. A cut analysis, a spending breakdown or an inbox
// review would arrive as a notification cut off mid-sentence with no way back
// to the rest of it. Anything substantial now lands in the dashboard's "needs
// you" queue with its full text and its own read-aloud.
const ANSWER_TOOLS = new Set([
  "general_question", "query_health", "query_finances", "query_tasks",
  "query_schedule", "query_notes", "query_projects", "query_people",
  "query_connections", "query_dining", "research_query", "review_inbox"
]);

// Short confirmations ("Created task X") are complete in the notification —
// filing those would turn the queue into a receipt printer.
const WORTH_KEEPING = 240;

async function fileAnswer(results, heard) {

  const answers = results.filter(r =>
    ANSWER_TOOLS.has(r.tool) &&
    !r.error &&
    r.result?.success !== false &&
    String(r.result?.message || "").length > WORTH_KEEPING
  );

  if (answers.length === 0) return;

  const body = answers.map(r => r.result.message.trim()).join("\n\n");

  const title = heard
    ? (heard.length > 90 ? `${heard.slice(0, 89)}…` : heard)
    : "You asked";

  try {

    const { default: supabase } = await import("./supabase.js");

    const { error } = await supabase.from("prompts").insert([{
      kind: "general_question",
      title,
      body,
      status: "pending"
    }]);

    if (error) console.error("CAPTURE ANSWER FILE FAILED:", error.message);

  } catch (error) {

    console.error("CAPTURE ANSWER FILE THREW:", error.message);

  }

}


// Never throws, and never blocks the response on a delivery problem. The
// capture itself already succeeded by the time this runs; a push failure must
// not turn a completed action into a 500.
export async function notifyCapture(results, heard = null) {

  try {

    // Filed regardless of the interruption level: turning notifications down
    // means "stop buzzing my phone", never "throw the answer away".
    await fileAnswer(results, heard);

    const notification = describeCapture(results, heard);

    if (!notification) return { sent: 0, skipped: "nothing to report" };

    if (!(await pushAllowed("capture_confirmation"))) {
      return { sent: 0, skipped: "interruption level" };
    }

    return await sendPush(notification);

  } catch (error) {

    console.error("CAPTURE NOTIFY FAILED:", error.message);

    return { sent: 0, error: error.message };

  }

}
