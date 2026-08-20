"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { syncDiningAction } from "./actions.js";


// Pull menus from the dining hall now, and keep pulling until there's nothing
// left to pull. Each server pass works a fixed time budget and reports what
// remains, so "the first big fill" and "top up tonight's edits" are the same
// button — this loop just calls again while the number keeps going down.
export default function DiningSyncButton() {

  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState(null);
  const cancelled = useRef(false);

  const sync = async () => {

    setRunning(true);
    setNote("Syncing…");
    cancelled.current = false;

    let total = 0;

    // The cap is a guard, not a plan: a full first fill takes well under
    // twenty passes, so hitting it means passes stopped making progress.
    for (let pass = 0; pass < 20 && !cancelled.current; pass++) {

      let result;

      try {
        result = await syncDiningAction();
      } catch {
        setNote("Sync failed — try again.");
        break;
      }

      if (result?.error || (result?.errors?.length && !result?.synced)) {
        setNote(result.error || result.errors[0]);
        break;
      }

      total += result?.synced || 0;

      const left = result?.remaining || 0;

      if (left <= 0) {
        setNote(total > 0 ? `Synced ${total} menus.` : "Already up to date.");
        break;
      }

      if (!result?.synced) {
        // A pass that moved nothing won't move next time either.
        setNote(`Stopped with ${left} menus left — try again later.`);
        break;
      }

      setNote(`Synced ${total} · ${left} to go…`);

    }

    router.refresh();
    setRunning(false);

  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={sync}
        disabled={running}
        className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
      >
        {running ? "Syncing…" : "Sync"}
      </button>
      {note && <span className="text-xs text-ink-soft">{note}</span>}
    </div>
  );

}
