"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";


export default function RefreshButton() {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      aria-label={isPending ? "Refreshing" : "Refresh dashboard"}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-pill)] border border-[var(--line)] bg-card text-ink-soft shadow-lift-sm transition-colors hover:text-ink disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-[18px] w-[18px] ${isPending ? "animate-spin" : ""}`}
        aria-hidden="true"
      >
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 5v6h-6" />
      </svg>
    </button>
  );

}
