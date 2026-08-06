"use client";

import { useTransition } from "react";
import { deleteDataItem } from "./actions.js";


export default function DeleteButton({ type, id }) {

  const [isPending, startTransition] = useTransition();

  const handleClick = () => {

    if (!confirm("Delete this permanently?")) return;

    startTransition(() => {
      deleteDataItem(type, id);
    });

  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ember hover:text-ember disabled:opacity-45"
    >
      {isPending ? "…" : "Delete"}
    </button>
  );

}
