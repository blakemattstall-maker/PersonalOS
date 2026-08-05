"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondDebateAction, endDebateAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";
import FeedbackCard from "./FeedbackCard.js";


function Dots() {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden="true">
      <span className="pos-dot" />
      <span className="pos-dot" />
      <span className="pos-dot" />
    </span>
  );
}


export default function DebateSession({ session }) {

  const router = useRouter();

  const [transcript, setTranscript] = useState(session.transcript || []);
  const [feedback, setFeedback] = useState(session.feedback || null);
  const [status, setStatus] = useState(session.status);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(null);


  const send = () => {

    if (!input.trim()) return;

    const message = input;
    setInput("");
    setError(null);

    const optimistic = [...transcript, { role: "user", message }];
    setTranscript(optimistic);

    startTransition(async () => {

      const result = await respondDebateAction(session.id, message);

      if (result?.success) {
        setTranscript([...optimistic, { role: "assistant", message: result.message }]);
      } else {
        setError(result?.error || "Something went wrong.");
      }

    });

  };


  const end = () => {

    setError(null);

    startTransition(async () => {

      const result = await endDebateAction(session.id);

      if (result?.success) {
        setFeedback(result.feedback);
        setStatus("completed");
        router.refresh();
      } else {
        setError(result?.error || "Couldn't grade this yet.");
      }

    });

  };


  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-6">

      <div className="space-y-3">
        {transcript.map((turn, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">
              {turn.role === "user" ? "You" : "Opponent"}
            </span>
            <p className="flex-1 text-foreground leading-relaxed">{turn.message}</p>
            {turn.role === "assistant" && <ReadAloud text={turn.message} title="Debate reply" />}
          </div>
        ))}

        {isPending && !feedback && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="text-xs font-medium uppercase tracking-wide">Opponent</span>
            <Dots />
          </div>
        )}
      </div>

      {status === "in_progress" && !feedback && (

        <>
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Your response — tap the mic on your keyboard to dictate"
              disabled={isPending}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={isPending || !input.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>

          <button
            onClick={end}
            disabled={isPending || transcript.length < 2}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
          >
            End & get graded
          </button>

          {transcript.length < 2 && (
            <p className="mt-1 text-xs text-muted">Respond at least once before ending.</p>
          )}
        </>

      )}

      {error && <p className="mt-3 text-sm text-foreground">{error}</p>}

      {feedback && <FeedbackCard type="debate" feedback={feedback} />}

    </div>
  );

}
