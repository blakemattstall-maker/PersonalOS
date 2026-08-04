"use server";

import { revalidatePath } from "next/cache";


export async function resolveDeepThought(id) {

  const backendUrl = process.env.BACKEND_URL;

  await fetch(`${backendUrl}/api/deepThoughts/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  revalidatePath("/");
  revalidatePath("/history");

}


export async function resolveNudge(id) {

  const backendUrl = process.env.BACKEND_URL;

  await fetch(`${backendUrl}/api/nudges/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  revalidatePath("/");
  revalidatePath("/history");

}
