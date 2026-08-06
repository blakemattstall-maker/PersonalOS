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

  return result;

}


export async function getVapidKeyAction() {

  const key = process.env.BACKEND_KEY;

  const res = await fetch(`${process.env.BACKEND_URL}/api/ingest/push`, {
    cache: "no-store",
    headers: key ? { "x-pos-key": key } : {}
  });

  return res.json();

}


export async function subscribeToPushAction(subscription) {

  const result = await backendPost("/api/ingest/push", { subscription });

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
