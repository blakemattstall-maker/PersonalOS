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
    // Health owns the body: weigh-ins, food, and training when it exists.
    // /food redirects here, so old shortcuts and links still land right.
    href: "/health",
    label: "Health",
    also: ["/food"],
    icon: (
      <>
        <path d="M12 20.5s-7-4.4-7-9.4a3.9 3.9 0 0 1 7-2.4 3.9 3.9 0 0 1 7 2.4c0 5-7 9.4-7 9.4z" />
        <path d="M4.8 12.6h3l1.4-2.3 1.8 4 1.5-2.6h6.7" />
      </>
    )
  },
  {
    href: "/money",
    label: "Money",
    icon: (
      <>
        <path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h12a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 18H6a2.5 2.5 0 0 1-2.5-2.5z" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M6.8 12h.01M17.2 12h.01" />
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
    href: "/news",
    label: "News",
    // Practice lives under News — reachable from the standing link at the
    // bottom of the news feed rather than owning a nav slot. `also` keeps this
    // tab lit while you're in there, so the bar never shows six unlit tabs on
    // a page you plainly reached from one of them.
    also: ["/practice"],
    icon: (
      <>
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H16a1 1 0 0 1 1 1v11a2 2 0 0 0 2 2H6a3 3 0 0 1-3-3z" />
        <path d="M17 9h2.5A1.5 1.5 0 0 1 21 10.5V17a2 2 0 0 1-2 2" />
        <path d="M7 9h6M7 12.5h6M7 16h3.5" />
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

  // Neither of the signed-out pages gets a nav bar. On /login it would offer
  // five destinations that all bounce straight back; on /welcome it would
  // promise a working app to someone who cannot get into one.
  if (pathname === "/login" || pathname === "/welcome") return null;

  return (
    <nav
      aria-label="Sections"
      className="pos-safe-bottom fixed inset-x-0 bottom-0 z-40 px-4 pt-2"
    >
      <div className="mx-auto flex w-full max-w-[24rem] items-stretch justify-between gap-1 rounded-[var(--r-pill)] border border-[var(--line)] bg-card/85 p-1.5 shadow-lift backdrop-blur-xl">

        {TABS.map(tab => {

          // Every other tab is a section root, so a prefix match keeps the tab
          // lit on nested routes like /practice/[id]. "/" would match
          // everything under that rule, hence the exact check. `also` lists
          // sections a tab covers without owning (News covers Practice).
          const active = tab.href === "/"
            ? pathname === "/"
            : pathname.startsWith(tab.href)
              || (tab.also || []).some(prefix => pathname.startsWith(prefix));

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
