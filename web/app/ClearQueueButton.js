"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearDashboardQueueAction } from "./actions.js";
import { btn } from "./ui.js";


export default function ClearQueueButton({ count }) {

  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();

  if (!count) return null;

  const clear = () => {
    startTransition(async () => {
      const result = await clearDashboardQueueAction();
      if (result?.success === false || result?.error) {
        setError(result.error || "The queue couldn't be cleared.");
        router.refresh();
        return;
      }
      setError(null);
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs text-ink-soft">Clear all {count}?</span>
          <button onClick={clear} disabled={isPending} className={btn("ember")}>
            {isPending ? "Clearing…" : "Yes, clear all"}
          </button>
          <button onClick={() => setConfirming(false)} disabled={isPending} className={btn("ghost")}>
            Cancel
          </button>
        </>
      ) : (
        <button onClick={() => setConfirming(true)} className={btn("quiet")}>
          Clear all
        </button>
      )}
      {error && <span className="text-xs text-ember">{error}</span>}
    </div>
  );

}
