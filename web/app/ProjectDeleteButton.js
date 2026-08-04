"use client";

import { useState, useTransition } from "react";
import { deleteProjectAction } from "./actions.js";


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
    return <span className="text-xs text-muted">Deleted.</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
    >
      {isPending ? "Deleting…" : "Delete project"}
    </button>
  );

}
