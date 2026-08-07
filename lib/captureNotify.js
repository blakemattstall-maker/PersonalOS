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
  query_people: "People"
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


// Prefer a link to the actual artefact over a link to the app. A Google
// Calendar event, a Gmail draft and an exported Doc all come back with a real
// URL already; there is no reason to drop him on a dashboard page instead.
function linkFor(entry) {

  const data = entry?.result?.data;

  return data?.url
    || data?.htmlLink
    || data?.data?.htmlLink
    || PAGE_FOR_TOOL[entry?.tool]
    || "/";

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
    : (TITLE_FOR_TOOL[first?.tool] || "PersonalOS");

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


// Never throws, and never blocks the response on a delivery problem. The
// capture itself already succeeded by the time this runs; a push failure must
// not turn a completed action into a 500.
export async function notifyCapture(results, heard = null) {

  try {

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
