"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runFundAction } from "./actions.js";


// Runs the fund on demand instead of waiting for tomorrow's cron.
//
// Needed on day one — a fund with no dispatches and no manager is impossible
// to evaluate, and waiting a day to find out whether it's any fun is the wrong
// feedback loop. After that it's mostly a "file today's again" button, which is
// why re-running deliberately requires the second press.
export default function RunFundButton() {

  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(null);
  const [confirmRefile, setConfirmRefile] = useState(false);

  const run = (force) => {

    setNote(null);

    startTransition(async () => {

      const result = await runFundAction(force);

      if (result?.needsMigration) {
        setNote("Run docs/schema-fund.sql in Supabase first.");
      } else if (result?.skipped) {
        // Already filed today — offer the override rather than silently
        // re-running, which would rewrite a dispatch already read.
        setConfirmRefile(true);
        setNote("Today's dispatch is already filed.");
      } else if (result?.success) {
        setConfirmRefile(false);
        setNote(result.headline || "Filed.");
      } else {
        setNote(result?.error || "Couldn't run it.");
      }

      router.refresh();

    });

  };

  return (
    <div className="flex flex-wrap items-center gap-3">

      <button
        onClick={() => run(false)}
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {isPending ? "Trading…" : "Run today"}
      </button>

      {confirmRefile && (
        <button
          onClick={() => run(true)}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
        >
          Re-file anyway
        </button>
      )}

      {note && <span className="text-xs text-muted">{note}</span>}

    </div>
  );

}
