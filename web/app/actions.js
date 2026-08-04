"use server";

import { revalidatePath } from "next/cache";
import { backendPost } from "./backend.js";


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


export async function buildPlanAction(id) {

  const result = await backendPost("/api/deepThoughts", { action: "buildPlan", id });

  revalidatePath("/");

  return result;

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
