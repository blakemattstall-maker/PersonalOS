"use client";

import { useEffect, useRef } from "react";
import { createTimeline, stagger, sceneTimeline, utils } from "../motion.js";
import { Stage } from "./parts.js";


// The division of labour that makes the morning brief trustworthy.
//
// Everything on the left is computed in JavaScript from the calendar, the task
// list, the people table and the bank feed. The model is handed those as
// settled facts and asked only to decide what matters and say it well. It is
// told, in the system prompt, not to do arithmetic — because a model that does
// its own arithmetic will occasionally be wrong and will always sound certain.
const FACTS = [
  "TODAY: Thursday, 7 August 2026",
  "CALENDAR (5.5h committed across 4):",
  "  [meeting] 9:00am-10:30am Sponsor sync with Cooper",
  "  [block]   11:00am-1:00pm Edit reel",
  "  [meeting] 1:00pm-1:45pm Advisor check-in",
  "  [personal] 7:00pm-9:00pm Dinner with Mom",
  "  OVERLAPS: \"Edit reel\" runs into \"Advisor check-in\"",
  "OVERDUE (1): Send Cooper the deck (due 2026-08-05)",
  "OPEN TASKS: 14",
  "GONE QUIET: Cooper — 19d since contact, wanted every 14d"
];

const BRIEF = [
  "The deck was due Tuesday and Cooper is in your calendar at nine, so that gets settled before it becomes a conversation about why it didn't.",
  "The two hours you blocked for the reel run straight into the advisor check-in at one. One of them moves — the check-in is the one with another person's afternoon attached to it, so move the edit.",
  "Nineteen days without contact and a meeting on the books is not a coincidence you should let him notice. Everything else today is genuinely fine."
];


export default function SceneBrief() {

  const ref = useRef(null);

  useEffect(() => sceneTimeline(

    ref.current,

    (root) => {

      const lines = root.querySelectorAll("[data-fact]");
      const sentences = root.querySelectorAll("[data-sentence]");
      const arrow = root.querySelector("[data-arrow]");

      utils.set(lines, { opacity: 0.35 });
      utils.set(sentences, { opacity: 0, translateY: 8 });
      utils.set(arrow, { opacity: 0 });

      const timeline = createTimeline({
        defaults: { ease: "out(3)" },
        loop: true,
        loopDelay: 3200
      });

      timeline
        // The facts land one at a time, in the order they're gathered.
        .add(lines, { opacity: 1, duration: 220, delay: stagger(95) })
        .add(arrow, { opacity: 1, duration: 400 }, "-=200")
        // Only then does anything get written.
        .add(sentences, { opacity: 1, translateY: 0, duration: 620, delay: stagger(420) }, "-=100")
        // Reset for the loop.
        .add(sentences, { opacity: 0, duration: 500 }, "+=2600")
        .add(lines, { opacity: 0.35, duration: 400 }, "<<")
        .add(arrow, { opacity: 0, duration: 400 }, "<<");

      return timeline;

    },

    {
      settleOnReduced: (root) => {
        utils.set(root.querySelectorAll("[data-fact]"), { opacity: 1 });
        utils.set(root.querySelectorAll("[data-sentence]"), { opacity: 1, translateY: 0 });
        utils.set(root.querySelector("[data-arrow]"), { opacity: 1 });
      }
    }

  ), []);

  return (
    <Stage minH="min-h-[30rem]">

      <div ref={ref} className="flex flex-col gap-5">

        <div>
          <p className="pos-data mb-2 text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
            Computed in code — no model involved
          </p>
          <div className="overflow-x-auto rounded-item bg-[var(--sunken)] px-3.5 py-3">
            <pre className="pos-data text-[0.68rem] leading-[1.7] text-ink sm:text-[0.72rem]">
              {FACTS.map((line, i) => (
                <div key={i} data-fact>{line}</div>
              ))}
            </pre>
          </div>
        </div>

        <div data-arrow className="flex items-center gap-3">
          <span aria-hidden="true" className="text-ink-soft">↓</span>
          <span className="pos-data text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
            Handed to the model, which decides what matters and says it
          </span>
        </div>

        <div className="space-y-3">
          {BRIEF.map((sentence, i) => (
            <p key={i} data-sentence className="text-[0.95rem] leading-relaxed text-ink">
              {sentence}
            </p>
          ))}
        </div>

      </div>

    </Stage>
  );

}
