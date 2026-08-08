import { NextResponse } from "next/server";


export function proxy(request) {

  const cookie = request.cookies.get("pos_session");

  const passphrase = process.env.SITE_PASSPHRASE;

  // Without the first check an unset SITE_PASSPHRASE compares undefined to
  // undefined, which passes — a missing env var would quietly make the whole
  // dashboard public rather than locking it.
  if (passphrase && cookie?.value === passphrase) {
    return NextResponse.next();
  }

  // Anyone without the cookie lands on the tour, not on a password box.
  // The link gets sent to people who have no credentials and never will —
  // a bare passphrase field tells them nothing and reads as a dead end.
  // /login still exists and is linked from the tour for the one person who
  // does have the passphrase.
  return NextResponse.redirect(new URL("/welcome", request.url));

}


// sw.js, manifest.json and the icon must stay reachable without the cookie.
// The browser fetches the service worker and manifest outside the page's
// session, so gating them doesn't protect anything — it just makes the app
// un-installable and push registration fail with no useful error. None of
// the three contain anything private.
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
  matcher: ["/((?!api|login|welcome|_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon.svg).*)"]
};
