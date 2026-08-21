"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";


// Career holds two genuinely different things — what he has and what he is
// chasing — and they are two PAGES, not two halves of one scroll. Money is a
// dashboard you read; Jobs is a feed you act on within hours. Stacking them
// would bury whichever came second.
const SECTIONS = [
  { href: "/career/money", label: "Money" },
  { href: "/career/jobs", label: "Jobs" },
  { href: "/career/pipeline", label: "Pipeline" }
];


export default function CareerNav() {

  const pathname = usePathname();

  return (
    <div className="mb-5 flex gap-1 self-start rounded-[var(--r-pill)] border border-[var(--line)] p-1">
      {SECTIONS.map(section => {

        const active = pathname.startsWith(section.href);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-[var(--r-pill)] px-4 py-1.5 text-[0.8rem] font-medium transition-colors ${
              active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {section.label}
          </Link>
        );

      })}
    </div>
  );

}
