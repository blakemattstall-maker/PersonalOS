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
        className="text-xs text-muted hover:text-accent disabled:opacity-50"
      >
        {isPending ? "Framing topics…" : "Load topics"}
      </button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );

}
