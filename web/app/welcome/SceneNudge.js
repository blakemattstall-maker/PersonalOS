"use client";

import { useEffect, useRef } from "react";
import { createTimeline, stagger, sceneTimeline, utils } from "../motion.js";
import { Stage } from "./parts.js";


// What the nudge engine throws away.
//
// The interesting part of an assistant that can message you is not the
// messaging. It is everything it decides not to send. This ran the naive way
// for one morning and delivered three notifications about the same thing
// before breakfast, all of them phrased "tomorrow", about a day that had
// already happened.
//
// The animation walks the actual pipeline in order: candidates, then dedupe,
// then the urgency filter, then the per-run cap, then placement into the hour
// of the day each one is most likely to be acted on.
const CANDIDATES = [
  { id: 0, text: "Last day at Trifilm is Friday", note: "generated Wed", fate: "merge-target" },
  { id: 1, text: "Last day at Trifilm is Friday", note: "generated Thu", fate: "duplicate" },
  { id: 2, text: "Trifilm internship wraps Friday", note: "generated Fri", fate: "duplicate" },
  { id: 3, text: "Reel still unedited — you said 11 days ago", note: "stalled intention", fate: "keep", at: "6:15pm" },
  { id: 4, text: "Bodyweight down 1.4lb this week", note: "trend, nothing owed", fate: "below-threshold" },
  { id: 5, text: "Cooper hasn't heard from you in 19 days", note: "cadence was 14", fate: "keep", at: "8:40am" }
];


function Row({ item }) {

  // Every badge a row can ever show is rendered from the start at opacity 0 and
  // faded in, because a badge inserted mid-timeline would reflow its row and
  // shove the rest of the list down under the reader's eye.
  //
  // They are taken out of the flow to do it. The first version left them in the
  // flex row, where `shrink-0` on three badges — two of them permanently
  // invisible — ate enough width to wrap a one-line nudge onto five lines. An
  // element that is never seen is still an element that takes up space.
  const badge = "pos-data pointer-events-none absolute right-3 top-2.5 rounded-[6px] px-2 py-1 text-[0.65rem] opacity-0";

  return (
    <div
      data-cand={item.id}
      className="relative rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 pr-24"
    >
      <span className="block text-[0.85rem] leading-snug text-ink">{item.text}</span>
      <span className="pos-data mt-0.5 block text-[0.68rem] text-ink-soft">{item.note}</span>

      {item.fate === "merge-target" && (
        <span data-merged={item.id} className={`${badge} bg-moss-wash text-moss`}>×3 merged</span>
      )}

      {item.fate === "duplicate" && (
        <span data-merged={item.id} className={`${badge} bg-[var(--sunken)] text-ink-soft`}>merged</span>
      )}

      {item.at && (
        <span data-when={item.id} className={`${badge} bg-ember-wash text-ember`}>{item.at}</span>
      )}

      {item.fate === "below-threshold" && (
        <span data-cut={item.id} className={`${badge} bg-[var(--sunken)] text-ink-soft`}>dropped</span>
      )}
    </div>
  );

}


const STEPS = [
  "Six candidates from three different sources",
  "Three say the same thing — merged into one",
  "One is a trend, not a request — below the threshold you set",
  "Two survive, each placed in the hour you actually act"
];


export default function SceneNudge() {

  const ref = useRef(null);

  useEffect(() => sceneTimeline(

    ref.current,

    (root) => {

      const pick = (attr, ids) => ids.map(i => root.querySelector(`[data-${attr}="${i}"]`)).filter(Boolean);

      const all = pick("cand", [0, 1, 2, 3, 4, 5]);
      const dupes = pick("cand", [1, 2]);
      const trend = pick("cand", [4]);
      // Queried from the same root as the rows rather than through a second
      // ref, so the timeline cannot be built against a half-mounted tree.
      const steps = root.querySelectorAll("[data-step]");

      utils.set(all, { opacity: 0, translateY: 8 });
      utils.set(steps, { opacity: 0.25 });

      const timeline = createTimeline({
        defaults: { ease: "out(3)" },
        loop: true,
        loopDelay: 2600
      });

      timeline
        // 1. everything arrives
        .add(steps[0], { opacity: 1, duration: 300 })
        .add(all, { opacity: 1, translateY: 0, duration: 460, delay: stagger(70) }, "-=200")

        // 2. the duplicates fold into the first
        //
        // They dim in place rather than being removed. Collapsing them out of
        // the list would leave a hole the height of two rows and shuffle
        // everything below mid-sentence; the point being made — that these
        // three are one thing — reads just as clearly at a quarter opacity.
        .add(steps[0], { opacity: 0.25, duration: 300 }, "+=900")
        .add(steps[1], { opacity: 1, duration: 300 }, "<<")
        .add(dupes, { opacity: 0.28, duration: 480, delay: stagger(90) }, "<<")
        .add(pick("merged", [1, 2]), { opacity: 1, duration: 380 }, "<<")
        .add(pick("merged", [0]), { opacity: 1, duration: 380 }, "-=180")

        // 3. the one nothing is owed on
        .add(steps[1], { opacity: 0.25, duration: 300 }, "+=700")
        .add(steps[2], { opacity: 1, duration: 300 }, "<<")
        .add(pick("cut", [4]), { opacity: 1, duration: 300 }, "<<")
        .add(trend, { opacity: 0.3, duration: 460 }, "<<")

        // 4. the survivors get an hour
        .add(steps[2], { opacity: 0.25, duration: 300 }, "+=700")
        .add(steps[3], { opacity: 1, duration: 300 }, "<<")
        .add(pick("when", [5, 3]), { opacity: 1, scale: [0.9, 1], duration: 420, delay: stagger(140) }, "<<")

        // 5. hold the result, then reset for the loop
        //
        // Every property touched above is returned to its start value here
        // rather than relying on the loop to do it — a timeline that loops
        // replays its tweens from wherever the elements happen to be.
        .add(all, { opacity: 0, duration: 420 }, "+=1800")
        .add(
          [...pick("merged", [0, 1, 2]), ...pick("when", [3, 5]), ...pick("cut", [4])],
          { opacity: 0, duration: 200 },
          "<<"
        )
        .add(steps[3], { opacity: 0.25, duration: 200 }, "<<");

      return timeline;

    },

    {
      // With motion off the scene is a static list of the six candidates and
      // the four rules, which is the same information without the theatre.
      settleOnReduced: (root) => {
        utils.set(root.querySelectorAll("[data-cand]"), { opacity: 1, translateY: 0 });
        utils.set(root.querySelectorAll("[data-cand='1'], [data-cand='2']"), { opacity: 0.28 });
        utils.set(root.querySelectorAll("[data-merged], [data-when], [data-cut]"), { opacity: 1 });
      }
    }

  ), []);

  return (
    <Stage minH="min-h-[24rem]">

      <div ref={ref}>

        <div className="space-y-2">
          {CANDIDATES.map(item => <Row key={item.id} item={item} />)}
        </div>

        <ol className="mt-5 space-y-1.5 border-t border-[var(--line)] pt-4">
          {STEPS.map((s, i) => (
            <li key={i} data-step className="flex gap-2.5 text-[0.82rem] leading-snug text-ink">
              <span className="pos-data shrink-0 text-ink-soft">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

      </div>

    </Stage>
  );

}
