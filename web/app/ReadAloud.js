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

    start();

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


  const glyph = state === "loading" ? "…" : state === "speaking" ? "◼" : "🔊";


  return (
    <span className="inline-flex items-center gap-2">

      <button
        onClick={toggle}
        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
        aria-label={state === "speaking" ? "Stop reading" : "Read aloud"}
      >
        {label ? (
          <span className="flex items-center gap-1.5">
            {glyph}
            <span>{state === "loading" ? "Preparing" : state === "speaking" ? "Stop" : "Listen"}</span>
          </span>
        ) : glyph}
      </button>

      {note && <span className="text-xs text-muted">{note}</span>}

    </span>
  );

}
