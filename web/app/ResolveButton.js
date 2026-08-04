"use client";

import { useTransition } from "react";
import { resolveDeepThought, resolveNudge } from "./actions.js";


export default function ResolveButton({ type, id }) {

  const [isPending, startTransition] = useTransition();

  const handleClick = () => {

    startTransition(async () => {

      if (type === "thought") {
        await resolveDeepThought(id);
      } else {
        await resolveNudge(id);
      }

    });

  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {isPending ? "Resolving…" : "Mark resolved"}
    </button>
  );

}
