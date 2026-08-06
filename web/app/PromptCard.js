"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerPromptAction } from "./actions.js";
import { ItemCard, btn, field } from "./ui.js";


// Things the app raised on its own: a place it wants named, a daily
// observation, an alert. Anything with a question gets an answer box; anything
// that's just telling you something gets dismissed.

const HEADINGS = {
  label_place: "What is this place?",
  digest: "Something worth noticing",
  relationship_checkin: "Time to check in"
};


export default function PromptCard({ item }) {

  const router = useRouter();

  const [answer, setAnswer] = useState("");
  const [isPending, startTransition] = useTransition();

  const needsAnswer = item.kind === "label_place";

  const submit = (value) => {
    startTransition(async () => {
      await answerPromptAction(item.id, value);
      router.refresh();
    });
  };


  return (
    <ItemCard kind="prompt" title={item.title || HEADINGS[item.kind]}>

      <p className="mt-2 leading-relaxed text-ink">{item.body}</p>

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

      {needsAnswer ? (

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

      ) : (

        <div className="mt-4">
          <button
            onClick={() => submit("dismissed")}
            disabled={isPending}
            className={btn("quiet")}
          >
            {isPending ? "Clearing…" : "Got it"}
          </button>
        </div>

      )}

    </ItemCard>
  );

}
