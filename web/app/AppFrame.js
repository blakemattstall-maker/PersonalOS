"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// How the app frames itself on a wide screen.
//
// Almanac is a phone product. On a desktop its content column would sit
// marooned in the middle of an empty page — the "why is this squished?" look —
// so above the phone breakpoint the app is shown inside a centred, phone-width
// screen resting on a darker desk, and the narrow width then reads as a
// deliberate choice. All of it is desktop-only: the pieces are gated with `lg:`
// and the CSS they pair with (globals.css) sits behind a min-width query, so on
// a phone this is an ordinary full-width passthrough with nothing added.
//
// The signed-out routes never get the frame. /welcome is a full-bleed marketing
// page; /login and /showcase are minimal gates. All must render edge to edge, the
// same rule TabBar and GraphButton already follow by returning null there. This
// is why the frame can't just live in the server layout, which wraps every
// route alike and has no view of the path.
export default function AppFrame({ showFixtureBar, children }) {

  const pathname = usePathname();

  // Next normally restores the document's scroll position. Signed-in routes
  // use the app's own stable scroller instead, so reset that surface whenever
  // the route changes. Keeping this element mounted is what prevents loading
  // screens and short pages from changing the mobile viewport underneath the
  // fixed navigation.
  useEffect(() => {
    const scroller = document.getElementById("pos-app-scroll");
    if (scroller) scroller.scrollTop = 0;
  }, [pathname]);

  // Fixture mode makes the dashboard look completely real. Say so, so nobody
  // reads invented spending figures as their own. Fires for the local preview
  // (POS_FIXTURES) and the private showcase session alike.
  const bar = showFixtureBar ? (
    <div className="bg-ember px-4 py-1 text-center text-[0.7rem] font-medium text-white">
      Showcase — fictional data, nothing here is real
    </div>
  ) : null;

  // Full width, no frame: the marketing and login pages own the whole page.
  if (pathname === "/welcome" || pathname === "/login" || pathname === "/showcase") {
    return (
      <>
        {bar}
        {children}
      </>
    );
  }

  return (
    <>
      {/* Desktop only, behind everything, purely decorative. The desk is a flat
          fixed surface covering the viewport; the screen is a paper panel the
          width of the frame that keeps the "screen" full height even on a short
          page and casts the shadow that lifts the phone off the desk. Both are
          `hidden` on a phone and fully described in globals.css. */}
      <div aria-hidden="true" className="pos-desk hidden lg:block" />
      <div aria-hidden="true" className="pos-screen hidden lg:block" />

      {/* The app column: full width on a phone, held to the frame width and
          centred on the desk on a wide screen. The demo bar lives inside it so
          it reads as part of the screen rather than a banner across the desk. */}
      <div className="flex h-[100dvh] min-h-0 flex-none flex-col overflow-hidden lg:mx-auto lg:w-[26rem]">
        {bar}
        <div
          id="pos-app-scroll"
          className="pos-app-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
        >
          {children}
        </div>
      </div>
    </>
  );

}
