import { NextResponse } from "next/server";
import { DEMO_SESSION } from "./lib/demo.js";


export function proxy(request) {

  const cookie = request.cookies.get("pos_session");

  const passphrase = process.env.SITE_PASSPHRASE;

  // Without the first check an unset SITE_PASSPHRASE compares undefined to
  // undefined, which passes — a missing env var would quietly make the whole
  // dashboard public rather than locking it.
  if (passphrase && cookie?.value === passphrase) {
    return NextResponse.next();
  }

  // The demo session walks through the same door. What it can SEE is decided
  // in backend.js — fixtures only, writes refused — so admitting it here
  // grants the shell of the app, never the contents.
  //
  // But a demo is a visit, not a home. The cookie used to admit its holder on
  // ARRIVAL too, so anyone who had ever clicked the demo button typed
  // getalmanac.xyz the next day and landed inside the fictional dashboard with
  // the pitch skipped — exactly backwards for the page doing the selling. The
  // Sec-Fetch headers tell the two apart: a document navigation arriving from
  // outside the site (typed URL, bookmark, a link on another site) goes to the
  // tour, while every navigation the demo makes from within — tab taps, server
  // actions, the entry redirect itself — is same-origin and passes untouched.
  // Browsers too old to send the headers just keep the old behaviour.
  if (cookie?.value === DEMO_SESSION) {
    const mode = request.headers.get("sec-fetch-mode");
    const site = request.headers.get("sec-fetch-site");
    if (mode === "navigate" && (site === "none" || site === "cross-site")) {
      return NextResponse.redirect(new URL("/welcome", request.url));
    }
    return NextResponse.next();
  }

  // Anyone without the cookie lands on the tour, not on a password box.
  // The link gets sent to people who have no credentials and never will —
  // a bare passphrase field tells them nothing and reads as a dead end.
  // /login still exists and is linked from the tour for the one person who
  // does have the passphrase.
  return NextResponse.redirect(new URL("/welcome", request.url));

}


// sw.js, manifest.json, the icon and opengraph-image must stay reachable
// without the cookie. The browser fetches the service worker and manifest
// outside the page's session, and a LINK SCRAPER (LinkedIn, iMessage, Slack)
// fetching the Open Graph preview image holds no session at all — gating any of
// them protects nothing and instead makes the app un-installable or the shared
// link preview blank. None of them contain anything private.
//
// `api` is excluded for a harder reason. The API now lives inside this app, and
// its callers are not browsers and hold no session cookie: the iOS Shortcut,
// Overland, Vercel Cron, and Google redirecting back from the OAuth consent
// screen. Without this exclusion every one of them would be answered with a
// redirect to /login — a capture would appear to succeed, return an HTML login
// page, and silently do nothing. The API is not left unguarded by this; it
// carries its own shared-secret check (lib/auth.js) plus CRON_SECRET and
// LOCATION_INGEST_KEY, which are the right kind of credential for a caller
// that cannot log in.
export const config = {
  matcher: ["/((?!api|login|welcome|_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon.svg|opengraph-image).*)"]
};
