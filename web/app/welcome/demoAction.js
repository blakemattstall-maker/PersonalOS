"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_SESSION } from "../../lib/demo.js";


// One tap into the fictional dashboard — no passphrase to type. Sets the same
// short-lived demo cookie the login page's demo branch sets; read-only is
// enforced server-side in backend.js regardless of how the session started, so
// a one-click entry point opens nothing a typed "demo" wouldn't.
export async function enterDemo() {

  const store = await cookies();

  store.set("pos_session", DEMO_SESSION, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24
  });

  redirect("/");

}
