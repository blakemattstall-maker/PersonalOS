"use client";

import { useState, useTransition } from "react";
import { archiveProjectAction, unarchiveProjectAction } from "./actions.js";


// Icon-only, next to the delete control, for the same reason delete is
// icon-only: a full "Archive" pill would be the second-loudest thing on every
// project card. Archiving is reversible and undramatic, so it doesn't need a
// confirmation the way delete does.
export default function ProjectArchiveButton({ id, archived = false }) {

  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const handleClick = () => {

    startTransition(async () => {
      await (archived ? unarchiveProjectAction(id) : archiveProjectAction(id));
      setDone(true);
    });

  };

  if (done) {
    return <span className="pos-data text-[0.7rem] text-ink-soft">{archived ? "Restored" : "Archived"}</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label={archived ? "Restore project" : "Archive project"}
      title={archived ? "Restore project" : "Archive project"}
      className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-pill)] text-ink-soft transition-colors hover:bg-[var(--sunken)] hover:text-ink disabled:opacity-45"
    >
      {isPending ? (
        <span className="pos-data text-[0.65rem]">…</span>
      ) : archived ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[17px] w-[17px]"
          aria-hidden="true"
        >
          <path d="M4 8.5h16M6 8.5v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9" />
          <path d="M5 8.5V6a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 6v2.5" />
          <path d="M14 13l-2-2-2 2M12 11v6" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[17px] w-[17px]"
          aria-hidden="true"
        >
          <rect x="3.5" y="4.5" width="17" height="4" rx="1.2" />
          <path d="M4.5 8.5v9.3a1.7 1.7 0 0 0 1.7 1.7h11.6a1.7 1.7 0 0 0 1.7-1.7V8.5" />
          <path d="M10 13h4" />
        </svg>
      )}
    </button>
  );

}
