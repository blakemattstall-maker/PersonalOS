import { redirect } from "next/navigation";


// Career opens on Money; Jobs is one tap away via the switcher. /money kept
// working the same way — an old link, a push payload or a home-screen
// shortcut must never dead-end.
export default function Redirect() {
  redirect("/career/money");
}
