"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

// Navigation used to exist on the home page only — six links crammed into a
// wrapping header row — while every other page offered nothing but "← Back".
// Getting from News to Practice meant a round trip through home, and each hop
// in this app costs 700ms–1.5s. This is the whole nav, on every page, one tap
// from anywhere.
//
// History and Manage data are deliberately not here. They're reached from
// where you'd actually want them: earlier briefs from the brief itself,
// data cleanup from Settings.

const TABS = [
  {
    href: "/",
    label: "Today",
    icon: (
      <>
        <path d="M3 17.5h18" />
        <path d="M7 17.5a5 5 0 0 1 10 0" />
        <path d="M12 4v2" />
        <path d="M5.2 7.7 6.6 9.1" />
        <path d="M18.8 7.7 17.4 9.1" />
      </>
    )
  },
  {
    href: "/news",
    label: "News",
    icon: (
      <>
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H16a1 1 0 0 1 1 1v11a2 2 0 0 0 2 2H6a3 3 0 0 1-3-3z" />
        <path d="M17 9h2.5A1.5 1.5 0 0 1 21 10.5V17a2 2 0 0 1-2 2" />
        <path d="M7 9h6M7 12.5h6M7 16h3.5" />
      </>
    )
  },
  {
    href: "/practice",
    label: "Practice",
    icon: (
      <>
        <rect x="9" y="3" width="6" height="10" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </>
    )
  },
  {
    href: "/people",
    label: "People",
    icon: (
      <>
        <circle cx="9.5" cy="8" r="3.2" />
        <path d="M3.5 19.5a6 6 0 0 1 12 0" />
        <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2" />
        <path d="M17.6 14.2a6 6 0 0 1 2.9 5.3" />
      </>
    )
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <>
        <path d="M3 7.5h9M16.5 7.5H21" />
        <path d="M3 16.5h4.5M12 16.5H21" />
        <circle cx="14.2" cy="7.5" r="2.2" />
        <circle cx="9.7" cy="16.5" r="2.2" />
      </>
    )
  }
];


// usePathname only changes once navigation has COMPLETED, so the tapped tab
// stayed dark for the whole wait and the tap read as ignored — which makes
// people tap again. useLinkStatus reports the pending state of the Link it sits
// inside, so the tab lights the instant it is pressed. Paired with the
// loading.js in each segment, the page swaps immediately too; this is the part
// that confirms *which* tab you hit.
function TabBody({ tab, active }) {

  const { pending } = useLinkStatus();

  const lit = active || pending;

  return (
    <>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-[19px] w-[19px] transition-opacity ${pending && !active ? "opacity-70" : ""}`}
        aria-hidden="true"
      >
        {tab.icon}
      </svg>
      <span className="text-[0.62rem] font-medium leading-none tracking-tight">
        {tab.label}
      </span>
    </>
  );

}


export default function TabBar() {

  const pathname = usePathname();

  // The passphrase gate is a single field on an empty page; a nav bar there
  // would offer five destinations that all bounce straight back to it.
  if (pathname === "/login") return null;

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="mx-auto flex w-full max-w-[24rem] items-stretch justify-between gap-1 rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 p-1.5 shadow-lift backdrop-blur-xl">

        {TABS.map(tab => {

          // Every other tab is a section root, so a prefix match keeps the tab
          // lit on nested routes like /practice/[id]. "/" would match
          // everything under that rule, hence the exact check.
          const active = tab.href === "/"
            ? pathname === "/"
            : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`group flex flex-1 flex-col items-center gap-1 rounded-[var(--r-pill)] px-1 py-2 transition-colors active:bg-[var(--sunken)] ${
                active ? "bg-[var(--sunken)] text-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              <TabBody tab={tab} active={active} />
            </Link>
          );

        })}

      </div>
    </nav>
  );

}
