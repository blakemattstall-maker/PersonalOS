"use client";

import { useState, useTransition } from "react";
import { deleteProjectAction } from "./actions.js";
import { btn } from "./ui.js";


export default function ProjectDeleteButton({ id, taskCount }) {

  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const handleClick = () => {

    const warning = taskCount > 0
      ? `Delete this project and its ${taskCount} task(s)/event(s) — including from Google, not just here?`
      : "Delete this project?";

    if (!confirm(warning)) return;

    startTransition(async () => {
      await deleteProjectAction(id);
      setDone(true);
    });

  };

  if (done) {
    return <span className="pos-data text-[0.7rem] text-ink-soft">Deleted</span>;
  }

  // Icon-only and low-contrast on purpose. As a full "Delete" pill this was the
  // second-loudest thing on every project card, competing with the project's
  // own name for a control used approximately never. It still confirms first,
  // and the confirm names what else goes with it.
  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label="Delete project"
      title="Delete project"
      className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-pill)] text-ink-soft transition-colors hover:bg-ember-wash hover:text-ember disabled:opacity-45"
    >
      {isPending ? (
        <span className="pos-data text-[0.65rem]">…</span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          className="h-[17px] w-[17px]"
          aria-hidden="true"
        >
          <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" />
          <path d="M6.5 7l.8 11a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-11" />
        </svg>
      )}
    </button>
  );

}
