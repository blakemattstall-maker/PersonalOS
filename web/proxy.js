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

  return NextResponse.redirect(new URL("/login", request.url));

}


// sw.js, manifest.json and the icon must stay reachable without the cookie.
// The browser fetches the service worker and manifest outside the page's
// session, so gating them doesn't protect anything — it just makes the app
// un-installable and push registration fail with no useful error. None of
// the three contain anything private.
export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon.svg).*)"]
};
