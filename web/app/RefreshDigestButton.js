"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNewsAction } from "./actions.js";


// The cron pulls a fresh digest once a day, but the first time this table
// existed there was nothing in it until something actually ran — this is
// that something, on demand, so a new day (or an empty table) doesn't mean
// waiting on a schedule to see it work.
export default function RefreshDigestButton() {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(null);

  const refresh = () => {

    setNote(null);

    startTransition(async () => {

      const result = await syncNewsAction();

      setNote(result?.success ? result.message : (result?.error || "Couldn't refresh."));

      router.refresh();

    });

  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={refresh}
        disabled={isPending}
        className="text-xs text-muted hover:text-accent disabled:opacity-50"
      >
        {isPending ? "Checking sources…" : "Refresh"}
      </button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );

}
