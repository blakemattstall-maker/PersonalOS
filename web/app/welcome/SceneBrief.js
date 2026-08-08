"use client";

import { useEffect, useRef } from "react";
import { createTimeline, stagger, sceneTimeline, utils } from "../motion.js";
import { Stage } from "./parts.js";


// The division of labour that makes a generated briefing trustworthy.
//
// Everything on the left is computed in ordinary code from the calendar, the
// task list, the contact records and the transaction feed. The language model
// is handed those as settled facts and asked only to decide what matters and
// say it well. It is told in the system prompt not to do arithmetic, because a
// model that does its own arithmetic will occasionally be wrong and will always
// sound certain. Sample data throughout.
const FACTS = [
  "TODAY: Thursday, 5 June 2025",
  "CALENDAR (5.5h committed across 4):",
  "  [meeting]  9:00am-10:30am Partner sync with Priya",
  "  [block]    11:00am-1:00pm Onboarding rewrite",
  "  [meeting]  1:00pm-1:45pm Design review",
  "  [personal] 7:00pm-9:00pm Dinner with Dana",
  "  OVERLAPS: \"Onboarding rewrite\" runs into \"Design review\"",
  "OVERDUE (1): Send Priya the partner deck (due 2025-06-03)",
  "OPEN TASKS: 14",
  "QUIET CONTACT: Priya, 19d since last contact, cadence set to 14d"
];

const BRIEF = [
  "The partner deck was due Tuesday and Priya is on your calendar at nine, so that gets settled before it turns into a conversation about why it wasn't.",
  "The two hours you blocked for the onboarding rewrite run straight into the design review at one. One of them has to move, and the review is the one with other people's afternoons attached to it, so move the rewrite.",
  "Nineteen days without contact and a meeting on the books is not a coincidence worth letting her notice. Everything else today is genuinely fine."
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

      // Plays once and holds. An earlier version looped, which meant clearing
      // the whole panel and waiting before starting again, so anyone who
      // arrived a second late read the section as empty and broken. A scene
      // that has finished should look finished.
      const timeline = createTimeline({ defaults: { ease: "out(3)" } });

      timeline
        // The facts land one at a time, in the order they are gathered.
        .add(lines, { opacity: 1, duration: 220, delay: stagger(95) })
        .add(arrow, { opacity: 1, duration: 400 }, "-=200")
        // Only then does anything get written.
        .add(sentences, { opacity: 1, translateY: 0, duration: 620, delay: stagger(420) }, "-=100");

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
            Assembled in code, with no model involved
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
