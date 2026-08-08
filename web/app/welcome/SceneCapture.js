"use client";

import { useEffect, useRef, useState } from "react";
import { animate, stagger, reducedMotion, utils } from "../motion.js";
import { Stage, TapHint } from "./parts.js";


// Three things somebody might actually say into a phone, and what the system
// makes of each.
//
// The examples are chosen to show the part that is easy to get wrong rather
// than the part that is easy to demo. Every one contains a relative date, and
// the resolved column is the point: "tomorrow" is resolved against the moment
// it was said and stored as a fixed date. This app shipped the other way round
// once and spent a week telling its owner that an internship he had already
// finished was ending tomorrow.
const CAPTURES = [
  {
    said: "Remind me to send Cooper the sponsorship deck tomorrow — and dinner with Mom is Thursday at 7.",
    spoken: "Thursday, 6 August, 4:12pm",
    resolved: [
      { from: "tomorrow", to: "Fri 7 Aug" },
      { from: "Thursday at 7", to: "Thu 13 Aug, 7:00pm" }
    ],
    items: [
      { kind: "task", label: "Task", title: "Send Cooper the sponsorship deck", meta: "Due Fri 7 Aug · Google Tasks" },
      { kind: "event", label: "Event", title: "Dinner with Mom", meta: "Thu 13 Aug 7:00pm · Google Calendar" },
      { kind: "link", label: "Links", title: "Cooper · Mom", meta: "matched two people already on file" }
    ]
  },
  {
    said: "I keep saying I want to get the film reel edited before school starts and I keep not doing it.",
    spoken: "Sunday, 2 August, 9:41pm",
    resolved: [
      { from: "before school starts", to: "Mon 18 Aug" }
    ],
    items: [
      { kind: "intention", label: "Intention", title: "Get the film reel edited", meta: "Soft deadline Mon 18 Aug · will be nudged" },
      { kind: "memory", label: "Memory", title: "Stated it twice without acting", meta: "second time in 11 days" },
      { kind: "link", label: "Links", title: "→ Reel project", meta: "existing project, marked stalled" }
    ]
  },
  {
    said: "Just spent eighty four dollars at Staples printing the pitch decks, worth it.",
    spoken: "Tuesday, 4 August, 1:07pm",
    resolved: [],
    items: [
      { kind: "memory", label: "Memory", title: "Printed pitch decks at Staples", meta: "captured verbatim" },
      { kind: "link", label: "Links", title: "→ $84.00 Staples", meta: "matched a real charge two days later" },
      { kind: "link", label: "Links", title: "→ Sponsorship deck", meta: "project cost now $84 recorded" }
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
  // pipeline actually produces it — text, then dates, then the filed items.
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
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-pressed={i === index}
            className={`rounded-[var(--r-pill)] px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors ${
              i === index
                ? "bg-ink text-paper"
                : "border border-[var(--line)] text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {["A reminder", "A wish", "A receipt"][i]}
          </button>
        ))}
      </div>

      <Stage>

        <div ref={outRef}>

          <div data-part>
            <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
              What he said · {capture.spoken}
            </p>
            <p className="mt-2 text-[1.05rem] leading-relaxed text-ink">
              &ldquo;{capture.said}&rdquo;
            </p>
          </div>

          {capture.resolved.length > 0 && (
            <div data-part className="mt-5">
              <p className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
                Dates pinned at capture
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
