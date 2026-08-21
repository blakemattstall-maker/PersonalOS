"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordStageAction } from "./actions.js";
import { Card, Empty, btn } from "./ui.js";


// What happened to each application, and the one tap it takes to say so.
//
// The stages offered depend on where the application already is: an
// application at "applied" can advance to a first round or die; one at a
// second round cannot go back to a first. Offering every stage everywhere
// would make the chart easy to corrupt with a mis-tap.

const NEXT = {
  applied:      ["first_round", "rejected", "withdrawn"],
  first_round:  ["second_round", "offer", "rejected", "withdrawn"],
  second_round: ["final_round", "offer", "rejected", "withdrawn"],
  final_round:  ["offer", "rejected", "withdrawn"],
  ghosted:      ["first_round", "rejected"],
  offer:        [],
  rejected:     [],
  withdrawn:    []
};

const LABEL = {
  first_round: "First round",
  second_round: "Second round",
  final_round: "Final round",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "I withdrew"
};

const CURRENT = {
  applied: "Applied", first_round: "First round", second_round: "Second round",
  final_round: "Final round", offer: "Offer", rejected: "Rejected",
  withdrawn: "Withdrew", ghosted: "No response"
};

const TONE = {
  offer: "text-ember", rejected: "text-ink-soft",
  withdrawn: "text-ink-soft", ghosted: "text-ink-soft"
};


export default function ApplicationList({ applications }) {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState(null);

  const record = (id, stage) => {
    setBusyId(id);
    startTransition(async () => {
      await recordStageAction(id, stage);
      setBusyId(null);
      router.refresh();
    });
  };

  if (!applications.length) {
    return <Empty>Nothing logged yet.</Empty>;
  }

  return (
    <Card>
      <ul>
        {applications.map(a => {

          const stage = a.currentStage || "applied";
          const options = NEXT[stage] || [];

          return (
            <li key={a.id} className="border-t border-[var(--line)] py-3.5 first:border-t-0">

              <div className="flex items-baseline justify-between gap-3">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 text-[0.88rem] font-medium leading-snug text-ink underline decoration-[var(--line)] underline-offset-4 hover:decoration-ink"
                >
                  {a.title}
                </a>
                <span className={`shrink-0 text-[0.72rem] ${TONE[stage] || "text-moss"}`}>
                  {CURRENT[stage] || stage}
                </span>
              </div>

              <p className="mt-0.5 text-[0.76rem] text-ink-soft">
                {a.company}
                {a.location ? ` · ${a.location}` : ""}
                {a.ghosted && a.silentDays != null ? ` · silent ${a.silentDays}d` : ""}
              </p>

              {options.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {options.map(next => (
                    <button
                      key={next}
                      onClick={() => record(a.id, next)}
                      disabled={isPending && busyId === a.id}
                      className={btn(next === "offer" ? "ember" : "quiet", next === "offer" ? "md" : "sm")}
                    >
                      {LABEL[next]}
                    </button>
                  ))}
                </div>
              )}

            </li>
          );

        })}
      </ul>
    </Card>
  );

}
