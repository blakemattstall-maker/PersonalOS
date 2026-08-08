"use client";

import { useEffect, useRef, useState } from "react";
import { animate, stagger, reducedMotion, utils } from "../motion.js";
import { Stage, TapHint } from "./parts.js";


// Three kinds of sentence, and what the system makes of each.
//
// The examples are chosen to show the part that is hard rather than the part
// that demos well. Every one contains a relative date, and the resolved column
// is the point: "tomorrow" is fixed to a calendar date at the moment it is
// said, never stored as the word. Everything here is invented sample data.
const CAPTURES = [
  {
    tab: "A reminder",
    said: "Remind me to send Priya the partner deck tomorrow, and dinner with Dana is Thursday at 7.",
    spoken: "Tuesday, 3 June, 4:12pm",
    resolved: [
      { from: "tomorrow", to: "Wed 4 Jun" },
      { from: "Thursday at 7", to: "Thu 5 Jun, 7:00pm" }
    ],
    items: [
      { kind: "task", label: "Task", title: "Send Priya the partner deck", meta: "Due Wed 4 Jun, added to your task list" },
      { kind: "event", label: "Event", title: "Dinner with Dana", meta: "Thu 5 Jun 7:00pm, added to your calendar" },
      { kind: "link", label: "Links", title: "Priya, Dana", meta: "matched two contacts already on record" }
    ]
  },
  {
    tab: "An intention",
    said: "I keep saying I want the onboarding walkthrough rewritten before the quarter closes and I keep not doing it.",
    spoken: "Sunday, 1 June, 9:41pm",
    resolved: [
      { from: "before the quarter closes", to: "Mon 30 Jun" }
    ],
    items: [
      { kind: "intention", label: "Intention", title: "Rewrite the onboarding walkthrough", meta: "Soft deadline Mon 30 Jun, eligible for a reminder" },
      { kind: "memory", label: "Note", title: "Stated twice without acting on it", meta: "second time in 11 days" },
      { kind: "link", label: "Links", title: "Onboarding refresh", meta: "existing project, now marked stalled" }
    ]
  },
  {
    tab: "An expense",
    said: "Just spent a hundred and forty six at Northline Print on the partner decks, worth it.",
    spoken: "Thursday, 5 June, 1:07pm",
    resolved: [],
    items: [
      { kind: "memory", label: "Note", title: "Printed partner decks at Northline Print", meta: "captured word for word" },
      { kind: "link", label: "Links", title: "$146.80 Northline Print", meta: "matched a real charge that cleared two days later" },
      { kind: "link", label: "Links", title: "Partner deck", meta: "project spend now recorded at $146.80" }
    ]
  }
];


const KIND_STYLE = {
  task: "bg-slate-wash text-ink",
  event: "bg-slate-wash text-ink",
  intention: "bg-moss-wash text-moss",
  memory: "bg-moss-wash text-moss",
  link: "bg-[var(--sunken)] text-ink-soft"
};


export default function SceneCapture() {

  const [index, setIndex] = useState(0);

  const outRef = useRef(null);

  const capture = CAPTURES[index];

  // Re-runs on every selection, which is the whole interaction: the previous
  // result clears and the new one is built in front of you, in the order the
  // pipeline actually produces it. Text, then dates, then the filed records.
  useEffect(() => {

    const root = outRef.current;

    if (!root) return;

    const parts = root.querySelectorAll("[data-part]");

    if (reducedMotion() || parts.length === 0) {
      utils.set(parts, { opacity: 1, translateY: 0 });
      return;
    }

    utils.set(parts, { opacity: 0, translateY: 10 });

    const animation = animate(parts, {
      opacity: 1,
      translateY: 0,
      duration: 480,
      delay: stagger(85),
      ease: "out(3)"
    });

    return () => {
      animation.pause();
      utils.set(parts, { opacity: 1, translateY: 0 });
    };

  }, [index]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {CAPTURES.map((c, i) => (
          <button
            key={c.tab}
            type="button"
            onClick={() => setIndex(i)}
            aria-pressed={i === index}
            className={`rounded-[var(--r-pill)] px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors ${
              i === index
                ? "bg-ink text-paper"
                : "border border-[var(--line)] text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {c.tab}
          </button>
        ))}
      </div>

      <Stage>

        <div ref={outRef}>

          <div data-part>
            <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
              What was said, {capture.spoken}
            </p>
            <p className="mt-2 text-[1.05rem] leading-relaxed text-ink">
              &ldquo;{capture.said}&rdquo;
            </p>
          </div>

          {capture.resolved.length > 0 && (
            <div data-part className="mt-5">
              <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
                Dates fixed at the moment of capture
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {capture.resolved.map(r => (
                  <span
                    key={r.from}
                    className="inline-flex items-center gap-2 rounded-[var(--r-pill)] border border-[var(--line)] px-3 py-1.5 text-[0.78rem]"
                  >
                    <span className="text-ink-soft line-through">{r.from}</span>
                    <span aria-hidden="true" className="text-ink-soft">→</span>
                    <span className="pos-data text-moss">{r.to}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div data-part className="mt-5">
            <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
              Filed
            </p>
          </div>

          <div className="mt-2 space-y-2">
            {capture.items.map((item, i) => (
              <div
                key={i}
                data-part
                className="flex items-start gap-3 rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-3"
              >
                <span
                  className={`pos-data shrink-0 rounded-[6px] px-2 py-1 text-[0.65rem] uppercase tracking-[0.06em] ${KIND_STYLE[item.kind]}`}
                >
                  {item.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9rem] leading-snug text-ink">{item.title}</span>
                  <span className="pos-data mt-1 block text-[0.7rem] text-ink-soft">{item.meta}</span>
                </span>
              </div>
            ))}
          </div>

        </div>

      </Stage>

      <TapHint>Tap the three above to see what each kind of sentence becomes.</TapHint>
    </>
  );

}
