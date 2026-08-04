"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToThreadAction, buildPlanAction, resolveDeepThought } from "./actions.js";
import { DeepThoughtBody } from "./shared.js";


function SpeakButton({ text }) {

  const speak = () => {

    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    window.speechSynthesis.speak(utterance);

  };

  return (
    <button
      onClick={speak}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
      aria-label="Read aloud"
    >
      🔊
    </button>
  );

}


export default function DeepThoughtThread({ thought, turns }) {

  const router = useRouter();

  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [lastAction, setLastAction] = useState(
    thought.thread_status === "ready_to_build" ? "propose_plan" : null
  );


  const handleSend = () => {

    if (!input.trim()) return;

    const message = input;
    setInput("");

    startTransition(async () => {

      const result = await respondToThreadAction(thought.id, message);

      setLastAction(result?.data?.action || null);

      router.refresh();

    });

  };


  const handleBuildPlan = () => {

    startTransition(async () => {

      await buildPlanAction(thought.id);

      router.refresh();

    });

  };


  const handleResolve = () => {

    startTransition(async () => {

      await resolveDeepThought(thought.id);

      router.refresh();

    });

  };


  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">

      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-foreground">{thought.topic}</h3>
      </div>

      {thought.status === "thinking" ? (

        <p className="mt-2 text-muted italic">Still thinking this through…</p>

      ) : (

        <>
          <DeepThoughtBody content={thought.content} />

          {turns.length > 0 && (

            <div className="mt-4 space-y-2 border-t border-border pt-3">
              {turns.map((turn) => (
                <div key={turn.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">
                    {turn.role === "user" ? "You" : "PersonalOS"}
                  </span>
                  <p className="flex-1 text-foreground">{turn.message}</p>
                  {turn.role === "assistant" && <SpeakButton text={turn.message} />}
                </div>
              ))}
            </div>

          )}

          <div className="mt-3 flex items-center gap-2">

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              placeholder="Respond — tap the mic on your keyboard to dictate"
              disabled={isPending}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
            />

            <button
              onClick={handleSend}
              disabled={isPending || !input.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "…" : "Send"}
            </button>

          </div>

          <div className="mt-3 flex flex-wrap gap-2">

            {lastAction === "propose_plan" && (
              <button
                onClick={handleBuildPlan}
                disabled={isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Build the plan
              </button>
            )}

            <button
              onClick={handleResolve}
              disabled={isPending}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Mark resolved
            </button>

          </div>
        </>

      )}

    </div>
  );

}
