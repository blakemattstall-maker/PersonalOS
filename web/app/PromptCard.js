"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerPromptAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";
import { ItemCard, btn, field } from "./ui.js";


// Things the app raised on its own: a place it wants named, a daily
// observation, an alert, or the answer to something you asked in passing that
// wasn't tied to a specific tool. Anything with a question gets an answer box;
// anything that's just telling you something gets dismissed.

const HEADINGS = {
  label_place: "What is this place?",
  digest: "Something worth noticing",
  relationship_checkin: "Time to check in",
  general_question: "You asked"
};


export default function PromptCard({ item }) {

  const router = useRouter();

  const [answer, setAnswer] = useState("");
  const [isPending, startTransition] = useTransition();

  // Kind is the real signal, but payload shape is checked too: raiseLabelPrompt
  // in tools/location.js always sets kind correctly, but there's no database
  // constraint guaranteeing that stays true forever, and a place-labelling
  // prompt with no way to actually label it is a dead end, not a degraded
  // experience. If it carries a place to name, it gets the input.
  const needsAnswer = item.kind === "label_place" || !!item.payload?.place_id;

  const submit = (value) => {
    startTransition(async () => {
      await answerPromptAction(item.id, value);
      router.refresh();
    });
  };


  return (
    <ItemCard kind="prompt" title={item.title || HEADINGS[item.kind]}>

      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="leading-relaxed text-ink">{item.body}</p>
        <ReadAloud text={item.body} title={item.title || HEADINGS[item.kind]} />
      </div>

      {needsAnswer ? (

        // The answer is the point of this card, so it comes before the map
        // link rather than after it — a secondary link sitting above the one
        // actual input made it easy to miss on a phone.
        <>
          <div className="mt-4 flex items-end gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && answer.trim()) submit(answer); }}
              placeholder="e.g. Schroeder Hall — math 9am, english 3pm"
              disabled={isPending}
              aria-label="Name this place"
              className={field("flex-1")}
            />
            <button
              onClick={() => answer.trim() && submit(answer)}
              disabled={isPending || !answer.trim()}
              className={`${btn("ember", "md")} shrink-0`}
            >
              {isPending ? "Saving…" : "Save name"}
            </button>
          </div>

          {item.payload?.maps_url && (
            <a
              href={item.payload.maps_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-fit text-[0.78rem] font-medium text-ink-soft underline decoration-[var(--line)] underline-offset-4 hover:text-ink"
            >
              See it on a map
            </a>
          )}
        </>

      ) : (

        <>
          {item.payload?.maps_url && (
            <a
              href={item.payload.maps_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-fit text-[0.82rem] font-medium text-ink-soft underline decoration-[var(--line)] underline-offset-4 hover:text-ink"
            >
              See it on a map
            </a>
          )}

          <div className="mt-4">
            <button
              onClick={() => submit("dismissed")}
              disabled={isPending}
              className={btn("quiet")}
            >
              {isPending ? "Clearing…" : "Got it"}
            </button>
          </div>
        </>

      )}

    </ItemCard>
  );

}
