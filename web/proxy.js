import { NextResponse } from "next/server";


export function proxy(request) {

  const cookie = request.cookies.get("pos_session");

  if (cookie?.value === process.env.SITE_PASSPHRASE) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));

}


export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"]
};
