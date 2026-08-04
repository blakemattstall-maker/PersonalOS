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
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
    >
      {isPending ? "…" : "Delete"}
    </button>
  );

}
