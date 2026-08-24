"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerPromptAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";
import { ItemCard, Body, btn, field as fieldClass } from "./ui.js";
import { speakable } from "../lib/linkify.js";


// Things the app raised on its own: a place it wants named, a daily
// observation, an alert, or the answer to something you asked in passing that
// wasn't tied to a specific tool. Anything with a question gets an answer box;
// anything that's just telling you something gets dismissed.

const HEADINGS = {
  label_place: "What is this place?",
  digest: "Something worth noticing",
  relationship_checkin: "Time to check in",
  general_question: "You asked",
  stale_review: "This looks out of date",
  check_in: "Checking in"
};


// Which kinds want typed words back, and what the box should say.
//
// This used to be one boolean testing for label_place, which meant every kind
// added afterwards silently rendered a "Got it" button and nothing else. That
// is not hypothetical: relationship_checkin has had a server-side recorder
// since it shipped — answerRelationshipCheckin, expecting a real answer — and
// no way whatsoever to type one. The card offered a dismiss, which submitted
// the literal string "dismissed" into a function built to read a reply.
//
// So the strings live with the kind. The placeholder, the label the screen
// reader announces and the button all come from here rather than being
// hardcoded to naming a place.
const ANSWERABLE = {
  label_place: {
    placeholder: "e.g. Schroeder Hall — math 9am, english 3pm",
    aria: "Name this place",
    action: "Save name"
  },
  relationship_checkin: {
    placeholder: "e.g. texted him Sunday, catching up next week",
    aria: "Say what happened with them",
    action: "Save"
  },
  check_in: {
    // The question itself is on the card, so the box asks for the shape of the
    // answer rather than repeating it.
    placeholder: "e.g. 5 negatives, 2 assisted",
    aria: "Log what you did",
    action: "Log it"
  }
};


export default function PromptCard({ item }) {

  const router = useRouter();

  const [answer, setAnswer] = useState("");
  const [isPending, startTransition] = useTransition();

  // The dashboard overwrites item.kind with "prompt" for card dispatch and
  // carries the row's own kind as promptKind — read THAT, or every branch
  // below is dead code. (item.kind stays as a fallback for any caller that
  // passes a raw row.)
  const promptKind = item.promptKind || item.kind;

  // Kind is the real signal, but payload shape is checked too: raiseLabelPrompt
  // in tools/location.js always sets kind correctly, but there's no database
  // constraint guaranteeing that stays true forever, and a place-labelling
  // prompt with no way to actually label it is a dead end, not a degraded
  // experience. If it carries a place to name, it gets the input.
  const field = ANSWERABLE[promptKind] || (item.payload?.place_id ? ANSWERABLE.label_place : null);

  const needsAnswer = Boolean(field);

  // What the recorder said back.
  //
  // This return value used to be thrown away, and answerPlaceLabel has been
  // returning a confirmation nobody has ever read. It matters more for a
  // check-in: "Logged. 7 pull ups — best 7, up 2 from your first" is the
  // progress he asked to be tracked, and the moment he wants to see it is the
  // moment he finishes typing.
  const [saved, setSaved] = useState(null);

  const submit = (value) => {
    startTransition(async () => {
      const result = await answerPromptAction(item.id, value);
      if (result?.message && result?.success !== false) {
        setSaved(result.message);
        // Left on screen rather than refreshing it away: the card vanishes on
        // the next load anyway, and the reply is the whole reward for typing.
        return;
      }
      router.refresh();
    });
  };


  return (
    <ItemCard kind="prompt" title={item.title || HEADINGS[promptKind]}>

      <div className="mt-2 flex items-start justify-between gap-3">
        <Body text={item.body} />
        <ReadAloud text={speakable(item.body)} title={item.title || HEADINGS[promptKind]} />
      </div>

      {promptKind === "stale_review" ? (

        // The staleness sweep found a stored claim the measurements contradict.
        // Three verdicts, none default: update rewrites the row (the bio
        // regenerates instead), retire deletes it, keep leaves it standing.
        <>
          {item.payload?.suggested && (
            <p className="mt-3 rounded-item bg-[var(--sunken)] px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-ink-soft">
              Would become: <span className="text-ink">{item.payload.suggested}</span>
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => submit("update")}
              disabled={isPending}
              className={btn("ember", "md")}
            >
              {isPending ? "Working…" : item.payload?.table === "profiles" ? "Regenerate bio" : "Update it"}
            </button>
            {item.payload?.table !== "profiles" && (
              <button
                onClick={() => submit("retire")}
                disabled={isPending}
                className={btn("quiet")}
              >
                Retire it
              </button>
            )}
            <button
              onClick={() => submit("keep")}
              disabled={isPending}
              className={btn("quiet")}
            >
              Keep as is
            </button>
          </div>
        </>

      ) : needsAnswer ? (

        // The answer is the point of this card, so it comes before the map
        // link rather than after it — a secondary link sitting above the one
        // actual input made it easy to miss on a phone.
        <>
          <div className="mt-4 flex items-end gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && answer.trim()) submit(answer); }}
              placeholder={field.placeholder}
              disabled={isPending}
              aria-label={field.aria}
              className={fieldClass("flex-1")}
            />
            <button
              onClick={() => answer.trim() && submit(answer)}
              disabled={isPending || !answer.trim()}
              className={`${btn("ember", "md")} shrink-0`}
            >
              {isPending ? "Saving…" : field.action}
            </button>
          </div>

          {/* What came back. For a check-in this is the progress line — the
              whole reason the question was worth answering. */}
          {saved && (
            <p className="pos-data mt-3 rounded-item bg-[var(--sunken)] px-3.5 py-2.5 text-[0.82rem] leading-relaxed text-moss">
              {saved}
            </p>
          )}

          {/* A check-in has to be dismissible without typing. Standing at the
              gym having done none of it is a real answer, and a card with no
              way out but a lie is a card that gets ignored. The recorder knows
              a dismissal from a log and writes no series entry for it. */}
          {promptKind === "check_in" && !saved && (
            <div className="mt-3">
              <button
                onClick={() => submit("dismissed")}
                disabled={isPending}
                className={btn("ghost")}
              >
                Not today
              </button>
            </div>
          )}

          {item.payload?.maps_url && (
            <a
              href={item.payload.maps_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-fit text-[0.78rem] font-medium text-ink-soft underline decoration-[var(--line)] underline-offset-4 hover:text-ink"
            >
              See it on a map
            </a>
          )}
        </>

      ) : (

        <>
          {item.payload?.maps_url && (
            <a
              href={item.payload.maps_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-fit text-[0.82rem] font-medium text-ink-soft underline decoration-[var(--line)] underline-offset-4 hover:text-ink"
            >
              See it on a map
            </a>
          )}

          <div className="mt-4">
            <button
              onClick={() => submit("dismissed")}
              disabled={isPending}
              className={btn("quiet")}
            >
              {isPending ? "Clearing…" : "Got it"}
            </button>
          </div>
        </>

      )}

    </ItemCard>
  );

}
