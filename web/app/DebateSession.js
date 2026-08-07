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
    <div className="mt-4 rounded-card bg-card p-5 shadow-lift">

      <div className="space-y-3">
        {transcript.map((turn, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
              {turn.role === "user" ? "You" : "Opponent"}
            </span>
            <p className="flex-1 text-ink leading-relaxed">{turn.message}</p>
            {turn.role === "assistant" && <ReadAloud text={turn.message} title="Debate reply" />}
          </div>
        ))}

        {isPending && !feedback && (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="text-[0.65rem] font-medium uppercase tracking-[0.08em]">Opponent</span>
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
              className="flex-1 rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={isPending || !input.trim()}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-2.5 text-[0.88rem] font-medium text-paper transition-colors hover:opacity-90 disabled:opacity-45 disabled:opacity-50"
            >
              Send
            </button>
          </div>

          <button
            onClick={end}
            disabled={isPending || transcript.length < 2}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
          >
            End & get graded
          </button>

          {transcript.length < 2 && (
            <p className="mt-1 text-xs text-ink-soft">Respond at least once before ending.</p>
          )}
        </>

      )}

      {error && <p className="mt-3 text-sm text-ink">{error}</p>}

      {feedback && <FeedbackCard type="debate" feedback={feedback} />}

    </div>
  );

}
