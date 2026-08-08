"use client";

import { useState, useTransition } from "react";
import { askFinanceAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";
import { field, btn } from "./ui.js";


// The same tool the Shortcut's "how am I doing financially" question reaches
// (tools/finances.js's queryFinances), asked from a box on the page rather
// than spoken into a phone. Every figure it can cite was already computed
// server-side before the model saw the question — see the comment at the top
// of finances.js — so this answers from the same numbers the charts above it
// are drawn from, never a second opinion about what they are.
export default function MoneyAsk({ days }) {

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();

  const ask = () => {

    if (!question.trim() || isPending) return;

    setError(null);

    const asked = question.trim();

    startTransition(async () => {

      const result = await askFinanceAction(asked, days);

      if (result?.success) {
        setAnswer({ question: asked, message: result.message });
      } else {
        setError(result?.message || "Couldn't reach your accounts right now.");
      }

    });

  };

  return (
    <div>

      <div className="flex items-end gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="e.g. how much did I spend on takeout this month?"
          disabled={isPending}
          aria-label="Ask a question about your money"
          className={field("flex-1")}
        />
        <button
          onClick={ask}
          disabled={isPending || !question.trim()}
          className={`${btn("ember", "md")} shrink-0`}
        >
          {isPending ? "…" : "Ask"}
        </button>
      </div>

      <p className="mt-2 text-[0.75rem] text-ink-soft">
        Answered from the same {days} days of transactions charted above — not a
        financial advisor, just your own numbers read back plainly.
      </p>

      {error && (
        <p className="mt-3 rounded-item bg-[var(--sunken)] px-3.5 py-2.5 text-[0.85rem] text-ink">
          {error}
        </p>
      )}

      {answer && (
        <div className="mt-3 rounded-item bg-[var(--sunken)] px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.78rem] font-medium text-ink-soft">&ldquo;{answer.question}&rdquo;</p>
            <ReadAloud text={answer.message} title="Money" />
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink">
            {answer.message}
          </p>
        </div>
      )}

    </div>
  );

}
