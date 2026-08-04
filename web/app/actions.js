"use server";

import { revalidatePath } from "next/cache";


export async function resolveDeepThought(id) {

  const backendUrl = process.env.BACKEND_URL;

  await fetch(`${backendUrl}/api/deepThoughts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  revalidatePath("/");
  revalidatePath("/history");

}


export async function resolveNudge(id) {

  const backendUrl = process.env.BACKEND_URL;

  await fetch(`${backendUrl}/api/nudges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  revalidatePath("/");
  revalidatePath("/history");

}


export async function deleteDataItem(type, id) {

  const backendUrl = process.env.BACKEND_URL;

  await fetch(`${backendUrl}/api/data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, id })
  });

  revalidatePath("/data");

}


export async function respondToThreadAction(id, message) {

  const backendUrl = process.env.BACKEND_URL;

  const res = await fetch(`${backendUrl}/api/deepThoughts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "respond", id, message })
  });

  const result = await res.json();

  revalidatePath("/");

  return result;

}


export async function buildPlanAction(id) {

  const backendUrl = process.env.BACKEND_URL;

  const res = await fetch(`${backendUrl}/api/deepThoughts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "buildPlan", id })
  });

  const result = await res.json();

  revalidatePath("/");

  return result;

}


export async function deleteProjectAction(id) {

  const backendUrl = process.env.BACKEND_URL;

  const res = await fetch(`${backendUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", id })
  });

  const result = await res.json();

  revalidatePath("/");
  revalidatePath("/history");

  return result;

}
