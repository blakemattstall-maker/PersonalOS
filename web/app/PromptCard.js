"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerPromptAction } from "./actions.js";


// Things the app raised on its own: a place it wants named, a daily
// observation, an alert. Anything with a question gets an answer box; anything
// that's just telling you something gets dismissed.

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
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">

      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {item.kind === "label_place" ? "New place"
          : item.kind === "digest" ? "Today"
          : item.kind === "relationship_checkin" ? "Check in"
          : item.kind}
      </div>

      {item.title && (
        <h3 className="mt-1 font-medium text-foreground">{item.title}</h3>
      )}

      <p className="mt-1 text-foreground leading-relaxed">{item.body}</p>

      {item.payload?.maps_url && (
        <a
          href={item.payload.maps_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-accent"
        >
          See it on a map →
        </a>
      )}

      {needsAnswer ? (

        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && answer.trim()) submit(answer); }}
            placeholder="e.g. Schroeder Hall — math 9am, english 3pm"
            disabled={isPending}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={() => answer.trim() && submit(answer)}
            disabled={isPending || !answer.trim()}
            className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>

      ) : (

        <button
          onClick={() => submit("dismissed")}
          disabled={isPending}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Got it
        </button>

      )}

    </div>
  );

}
