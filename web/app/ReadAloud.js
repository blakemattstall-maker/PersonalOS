"use client";

import { useEffect, useRef, useState } from "react";
import { speak, stop } from "./speech.js";
import { readPrefs } from "./prefs.js";


// One read-aloud control, used by both the brief and each thread reply.
//
// The neural engine adds a wait the device engine never had — the audio has to
// be generated before anything plays — so the button has a real loading state.
// Without it the first press looks like nothing happened and gets pressed
// again, which cancels the request that was already in flight.
export default function ReadAloud({ text, title, label = false, autoplay = false }) {

  const [state, setState] = useState("idle");
  const [note, setNote] = useState(null);
  const armed = useRef(false);


  useEffect(() => () => stop(), []);


  const start = async () => {

    setNote(null);
    setState("loading");

    const result = await speak(text, {
      title,
      onState: s => setState(s),
      onEnd: () => setState("idle")
    });

    if (result?.fellBack) {
      setNote("Used the device voice — couldn't reach the speech service.");
    }

    if (result?.engine === "aborted") setState("idle");

  };


  // Autoplay is opt-in from settings and still only works once the user has
  // interacted with the page at least once in this session — browsers refuse
  // unprompted audio, which is the correct behaviour and not worth fighting.
  useEffect(() => {

    if (!autoplay || armed.current || !text) return;

    armed.current = true;

    if (!readPrefs().autoplayBrief) return;

    // Kicked off after this effect returns rather than from inside it. start()
    // sets React state synchronously, and doing that in an effect body forces
    // exactly the cascading render react-hooks/set-state-in-effect exists to
    // catch: the brief renders, immediately re-renders into "loading", and only
    // then does the browser get to paint. Autoplay has no business being part of
    // the first paint. The timer also gives unmount something to cancel, so a
    // brief navigated away from in that first tick never starts talking from a
    // component that no longer exists.
    const kickoff = setTimeout(start, 0);

    return () => clearTimeout(kickoff);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, text]);


  const toggle = () => {

    if (state !== "idle") {
      stop();
      setState("idle");
      return;
    }

    start();

  };


  // Drawn rather than an emoji: 🔊 renders at a different size and baseline in
  // every browser, and next to a set type scale it read as a sticker.
  //
  // A plain JSX value, not a component defined during render. The latter gets a
  // new function identity on every render, so React tears the <svg> down and
  // rebuilds it each time `state` changes instead of patching the two paths that
  // actually differ.
  const glyph = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[15px] w-[15px] shrink-0"
      aria-hidden="true"
    >
      {state === "speaking" ? (
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
      ) : (
        <>
          <path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z" />
          {state !== "loading" && <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />}
        </>
      )}
    </svg>
  );


  return (
    <span className="inline-flex items-center gap-2">

      <button
        onClick={toggle}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] text-[0.75rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink ${
          label ? "px-3 py-1.5" : "h-7 w-7 justify-center"
        }`}
        aria-label={state === "speaking" ? "Stop reading" : "Read aloud"}
      >
        {glyph}
        {label && (
          <span>{state === "loading" ? "Preparing" : state === "speaking" ? "Stop" : "Listen"}</span>
        )}
      </button>

      {note && <span className="text-[0.75rem] text-ink-soft">{note}</span>}

    </span>
  );

}
