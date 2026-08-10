"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolveInsightAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";
import { ItemCard, btn } from "./ui.js";


// Something the graph noticed by putting two domains side by side.
//
// Distinct from PromptCard, which asks you a question. This tells you
// something, and the only thing it needs back is whether it was worth telling
// you — which is the entire feedback loop this system has ever had about its
// own detectors, and it did not exist until now. `insights.acted_on` shipped
// with the graph and nothing ever wrote to it.
//
// So there are two buttons, not one. "Got it" clears it; "Did something about
// this" clears it and records that a finding of this kind produced an action.
// One extra tap, and it is the difference between four detectors firing blind
// forever and four detectors anyone can eventually rank.

export default function InsightCard({ item }) {

  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(null);

  // The strongest finding's first ref. `entities` is stored as
  // { findings: [...], refs: [...] } and refs are ordered by the finding that
  // produced them, so the head is the thing this insight is most about.
  const evidence = (item.entities?.refs || []).find(ref => ref?.type && ref?.id) || null;

  // Trap #15: a server action whose result is thrown away cannot fail. The
  // card would clear itself on screen, the row would be untouched, and the
  // insight would reappear on the next load with no explanation.
  //
  // Both failure shapes have to be checked, and missing one is how this nearly
  // shipped looking fine. A failure this code returns deliberately arrives as
  // `{ success: false }`; a handler that threw arrives from app/backend.js as
  // `{ error: "Request failed with 500" }` and carries no `success` key at all,
  // so a `success === false` test alone silently treats a 500 as a success.
  const resolve = (acted) => {
    startTransition(async () => {

      const result = await resolveInsightAction(item.id, acted);

      if (result?.success === false || result?.error) {
        setFailed(result.error || "That didn't save.");
        return;
      }

      setFailed(null);
      router.refresh();

    });
  };

  return (
    <ItemCard kind="insight" title={item.title}>

      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="leading-relaxed text-ink">{item.body}</p>
        <ReadAloud text={item.body} title={item.title} />
      </div>

      {failed && (
        <p className="mt-3 text-[0.82rem] text-ember-ink">{failed}</p>
      )}

      {/* "Why are you telling me this."

          An insight already stores the entity refs the detectors fired on, and
          until now that evidence was write-only — recoverable from the database
          and reachable from nowhere. This walks straight to it. Category refs
          resolve too, now that a spending category is a real node.

          Guarded rather than assumed: insights written before refs were stored
          have none, and a link to `undefined` is a page that says nothing is
          connected to nothing. */}
      {evidence && (
        <Link
          href={`/graph?type=${encodeURIComponent(evidence.type)}&id=${encodeURIComponent(evidence.id)}`}
          className="pos-data mt-3 inline-flex items-center gap-1 text-[0.72rem] text-ink-soft underline decoration-[var(--line)] underline-offset-[3px] hover:text-ink"
        >
          See what this is built on
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <div className="mt-4 flex flex-wrap gap-2">

        <button
          onClick={() => resolve(true)}
          disabled={isPending}
          className={btn("ember", "md")}
        >
          {isPending ? "Saving…" : "Did something about this"}
        </button>

        <button
          onClick={() => resolve(false)}
          disabled={isPending}
          className={btn("quiet")}
        >
          Got it
        </button>

      </div>

    </ItemCard>
  );

}
