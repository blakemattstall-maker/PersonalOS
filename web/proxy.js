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


export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"]
};
