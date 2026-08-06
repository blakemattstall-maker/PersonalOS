"use client";

import { useTransition } from "react";
import { resolveDeepThought, resolveNudge } from "./actions.js";
import { btn } from "./ui.js";


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
      className={`${btn("quiet")} mt-4`}
    >
      {isPending ? "Clearing…" : "Mark resolved"}
    </button>
  );

}
