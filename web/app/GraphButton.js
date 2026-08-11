"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";


// The way into /graph from anywhere.
//
// The first attempt at graph discoverability was links on project, person and
// insight cards — which are real, but they are all *inside* cards, so with no
// active project and no pending insight there was no way into the page at all.
// The feature shipped and was invisible. The card links stay (they arrive
// pre-centred on the thing being looked at); this is the unconditional door.
//
// Top-right, floating, because that corner is empty on every page and the
// bottom bar is full at six. Same signed-out rule as the TabBar: /welcome
// must not offer a working app it cannot deliver, and /login must not offer
// five doors that bounce back.
//
// The glyph is the insight tile's — separate nodes with the edges drawn in —
// because it IS that: the card says two things are connected, this page shows
// the connections.

export default function GraphButton() {

  const pathname = usePathname();

  if (pathname === "/login" || pathname === "/welcome") return null;

  const active = pathname.startsWith("/graph");

  return (
    <Link
      href="/graph"
      aria-label="Connections"
      aria-current={active ? "page" : undefined}
      className={`pos-graph-frame fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-40 grid h-11 w-11 place-items-center rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 shadow-lift backdrop-blur-xl transition-colors ${
        active ? "text-ink" : "text-ink-soft hover:text-ink"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[19px] w-[19px]"
        aria-hidden="true"
      >
        <circle cx="6" cy="7" r="2.4" />
        <circle cx="18" cy="7" r="2.4" />
        <circle cx="12" cy="17.5" r="2.4" />
        <path d="M8.4 7h7.2" />
        <path d="M7.2 9.1l3.6 6.3" />
        <path d="M16.8 9.1l-3.6 6.3" />
      </svg>
    </Link>
  );

}
