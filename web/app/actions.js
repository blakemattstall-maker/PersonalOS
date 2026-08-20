"use server";

import { revalidatePath } from "next/cache";
import { backendPost, backendGet } from "./backend.js";


export async function resolveDeepThought(id) {

  await backendPost("/api/deepThoughts", { id });

  revalidatePath("/");
  revalidatePath("/history");

}


export async function resolveNudge(id) {

  await backendPost("/api/nudges", { id });

  revalidatePath("/");
  revalidatePath("/history");

}


export async function deleteDataItem(type, id) {

  await backendPost("/api/data", { type, id });

  revalidatePath("/data");

}


export async function respondToThreadAction(id, message) {

  const result = await backendPost("/api/deepThoughts", { action: "respond", id, message });

  revalidatePath("/");

  return result;

}


export async function buildPlanAction(id, tools = null) {

  const result = await backendPost("/api/deepThoughts", { action: "buildPlan", id, tools });

  revalidatePath("/");

  return result;

}


export async function transcribeAction({ audio_base64, mime_type }) {

  return backendPost("/api/deepThoughts", { action: "transcribe", audio_base64, mime_type });

}


export async function resetBuildAction(id) {

  await backendPost("/api/deepThoughts", { action: "resetBuild", id });

  revalidatePath("/");

}


export async function deleteProjectAction(id) {

  const result = await backendPost("/api/projects", { action: "delete", id });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/settings/archived");

  return result;

}


// Archiving is a plain status write on the same free-text column
// createProject/updateProject already use — no delete, no touching the tasks
// or events already sitting in Google. It just stops showing up on Today.
export async function archiveProjectAction(id) {

  const result = await backendPost("/api/projects", { id, status: "archived" });

  revalidatePath("/");
  revalidatePath("/settings/archived");

  return result;

}


export async function unarchiveProjectAction(id) {

  const result = await backendPost("/api/projects", { id, status: "active" });

  revalidatePath("/");
  revalidatePath("/settings/archived");

  return result;

}


// The last caller in this file still fetching over HTTP, which it no longer has
// any reason to do — the handler is in this deployment. It also meant push setup
// depended on BACKEND_URL and BACKEND_KEY still being set on a project that no
// longer needs either: unset one and this became fetch("undefined/api/...").
export async function getVapidKeyAction() {

  return backendGet("/api/ingest/push");

}


export async function subscribeToPushAction(subscription) {

  const result = await backendPost("/api/ingest/push", { subscription });

  // Surfaced rather than returned-and-ignored. This call silently failed for as
  // long as the in-process route was missing, and because the caller threw the
  // result away the settings page said "On" every time — the subscription was
  // never stored and no notification could ever arrive. A registration that did
  // not register has to be an error the user sees.
  if (!result?.success) {
    throw new Error(result?.error || "Couldn't save the subscription.");
  }

  return result;

}


export async function getSettingsAction() {

  return backendGet("/api/settings");

}


export async function saveSettingsAction(patch) {

  const result = await backendPost("/api/settings", patch);

  revalidatePath("/settings");

  return result;

}


export async function getDiagnosticsAction() {

  return backendGet("/api/diag");

}


export async function sendTestPushAction() {

  return backendPost("/api/diag", { action: "testPush" });

}


// Debate now argues evergreen topics; the news_item path stays for sessions
// started before the split and for arguing a live story on purpose.
export async function startDebateAction({ debate_topic_id, news_item_id, user_side }) {

  const result = await backendPost("/api/practice", {
    action: "startDebate",
    debate_topic_id,
    news_item_id,
    user_side
  });

  revalidatePath("/practice");

  return result;

}


export async function retireTopicAction(topic_id) {

  const result = await backendPost("/api/practice", { action: "retireTopic", topic_id });

  revalidatePath("/practice");

  return result;

}


export async function syncTopicsAction() {

  const result = await backendGet("/api/practice?syncTopics=1");

  revalidatePath("/practice");

  return result;

}


export async function generatePitchTopicAction() {

  return backendPost("/api/practice", { action: "generateTopic" });

}


export async function respondDebateAction(session_id, message) {

  return backendPost("/api/practice", { action: "respondDebate", session_id, message });

}


export async function endDebateAction(session_id) {

  const result = await backendPost("/api/practice", { action: "endDebate", session_id });

  revalidatePath("/practice");

  return result;

}


export async function submitPitchAction({ audio_base64, mime_type, topic, mode, prompt }) {

  const result = await backendPost("/api/practice", {
    action: "submitPitch",
    audio_base64,
    mime_type,
    topic,
    mode,
    prompt
  });

  revalidatePath("/practice");

  return result;

}


export async function deleteNewsAction(news_item_id) {

  const result = await backendPost("/api/news", { action: "delete", news_item_id });

  revalidatePath("/news");

  return result;

}


export async function syncNewsAction() {

  const result = await backendGet("/api/news?sync=1");

  revalidatePath("/news");

  return result;

}


// One budgeted slice of the dining sync. The button on /food calls this in a
// loop until `remaining` hits zero — see DiningSyncButton.js.
export async function syncDiningAction() {

  const result = await backendPost("/api/dining", { action: "sync" });

  revalidatePath("/food");

  return result;

}


export async function savePersonAction(person) {

  const result = await backendPost("/api/people", person);

  revalidatePath("/people");

  return result;

}


export async function deletePersonAction(id) {

  const result = await backendPost("/api/people", { action: "delete", id });

  revalidatePath("/people");

  return result;

}


export async function logContactAction(name) {

  const result = await backendPost("/api/people", { action: "logContact", name });

  revalidatePath("/people");

  return result;

}


export async function answerPromptAction(id, answer) {

  const result = await backendPost("/api/data", { type: "prompt", id, answer });

  revalidatePath("/");

  return result;

}


// Clearing an insight, and saying whether it was worth making.
//
// The second half is the point. `insights.acted_on` has existed since the
// graph shipped and nothing has ever written to it, so four detectors have
// been firing with no feedback whatsoever about which of them produce
// something a person acts on. "Got it" and "Did something about this" are one
// extra tap and the only signal that difference has ever had.
export async function resolveInsightAction(id, acted) {

  const result = await backendPost("/api/data", {
    type: "insight",
    id,
    answer: acted ? "acted" : "dismissed"
  });

  revalidatePath("/");

  return result;

}


// Same tool the Shortcut's query_finances call reaches, so the answer to
// "what did I spend on takeout" is identical whether it's asked in the app or
// spoken into a phone. No revalidatePath — this reads, it never changes what's
// on the money page underneath it.
export async function askFinanceAction(question, days) {

  return await backendPost("/api/finance", { question, days });

}
