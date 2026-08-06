"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncTopicsAction } from "./actions.js";


// Tops up the evergreen debate deck on demand.
//
// The daily cron does this too, but a deck that starts empty shouldn't require
// waiting until tomorrow morning to become usable — and framing is idempotent
// by slug, so pressing this repeatedly costs a little money and breaks nothing.
export default function LoadTopicsButton() {

  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(null);

  const load = () => {

    setNote(null);

    startTransition(async () => {

      const result = await syncTopicsAction();

      setNote(
        result?.needsMigration
          ? "Run docs/schema-practice-split.sql in Supabase first."
          : (result?.message || result?.error || "Couldn't load topics.")
      );

      router.refresh();

    });

  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={load}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
      >
        {isPending ? "Framing topics…" : "Load topics"}
      </button>
      {note && <span className="text-xs text-ink-soft">{note}</span>}
    </div>
  );

}
