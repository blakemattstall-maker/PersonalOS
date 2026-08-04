"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { respondToThreadAction, buildPlanAction, resolveDeepThought, resetBuildAction } from "./actions.js";
import { DeepThoughtBody } from "./shared.js";


function Dots() {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden="true">
      <span className="pos-dot" />
      <span className="pos-dot" />
      <span className="pos-dot" />
    </span>
  );
}


// Browser speech synthesis is what it is, but the default pick is usually the
// worst voice installed. iOS/macOS ship noticeably better ones (Ava, Samantha,
// Allison), and users who've downloaded Enhanced/Premium voices in Accessibility
// settings get much better results — so score the list rather than taking [0].
// Note: Siri's own voices are not exposed to the web, so this is the ceiling
// without going server-side for real TTS.
const VOICE_PREFERENCE = ["ava", "samantha", "allison", "susan", "zoe", "karen", "moira"];

function pickVoice() {

  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;

  const voices = window.speechSynthesis.getVoices().filter(v => v.lang?.startsWith("en"));

  if (voices.length === 0) return null;

  const score = (v) => {
    const name = v.name.toLowerCase();
    let s = 0;
    if (name.includes("premium")) s += 60;
    if (name.includes("enhanced")) s += 50;
    if (name.includes("natural") || name.includes("neural")) s += 45;
    const rank = VOICE_PREFERENCE.findIndex(p => name.includes(p));
    if (rank !== -1) s += 30 - rank * 2;
    // Network voices generally beat the compact on-device ones.
    if (v.localService === false) s += 15;
    if (v.lang === "en-US") s += 5;
    // Compact is Apple's explicitly low-quality tier.
    if (name.includes("compact")) s -= 40;
    return s;
  };

  return voices.slice().sort((a, b) => score(b) - score(a))[0] || null;

}


function SpeakButton({ text }) {

  const [speaking, setSpeaking] = useState(false);

  // Safari populates the voice list asynchronously; without this the first
  // press of the session always gets the default robotic voice.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  const speak = () => {

    if (!("speechSynthesis" in window)) return;

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);

    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    // Slightly slower than default reads far less clipped and mechanical.
    utterance.rate = 0.97;
    utterance.pitch = 1.0;

    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    setSpeaking(true);
    window.speechSynthesis.speak(utterance);

  };

  return (
    <button
      onClick={speak}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
      aria-label={speaking ? "Stop reading" : "Read aloud"}
    >
      {speaking ? "◼" : "🔊"}
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

  const isBuilding = thought.thread_status === "building";
  const [buildStalled, setBuildStalled] = useState(false);

  // The build runs in the background on the server now, so the page has to
  // come back and look. Stops as soon as thread_status moves off "building".
  useEffect(() => {

    if (!isBuilding) {
      setBuildStalled(false);
      return;
    }

    const timer = setInterval(() => router.refresh(), 4000);

    // A build normally lands in ~20s. If it's still going well past that, the
    // server-side work was probably killed — offer a way out rather than
    // spinning forever.
    const stall = setTimeout(() => setBuildStalled(true), 90000);

    return () => { clearInterval(timer); clearTimeout(stall); };

  }, [isBuilding, router]);


  const handleResetBuild = () => {
    startTransition(async () => {
      await resetBuildAction(thought.id);
      setLastAction("propose_plan");
      router.refresh();
    });
  };


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

        <p className="mt-2 flex items-center gap-2 text-muted italic">
          Still thinking this through <Dots />
        </p>

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

          {isPending && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted">
              <span className="text-xs font-medium uppercase tracking-wide">PersonalOS</span>
              <Dots />
            </div>
          )}

          {isBuilding ? (

            <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-accent">
                Building your plan <Dots />
              </div>
              <p className="mt-1 text-xs text-muted">
                Writing the workback schedule and creating the tasks and calendar
                events. This takes up to a minute — it&apos;ll appear under Projects
                on its own.
              </p>

              {buildStalled && (
                <div className="mt-3 border-t border-accent/30 pt-2">
                  <p className="text-xs text-muted">
                    This is taking longer than it should.
                  </p>
                  <button
                    onClick={handleResetBuild}
                    disabled={isPending}
                    className="mt-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    Cancel and try again
                  </button>
                </div>
              )}
            </div>

          ) : (

            <>
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
                  {isPending ? <Dots /> : "Send"}
                </button>

              </div>

              <div className="mt-3 flex flex-wrap gap-2">

                {lastAction === "propose_plan" && (
                  <button
                    onClick={handleBuildPlan}
                    disabled={isPending}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {isPending ? "Starting…" : "Build the plan"}
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
        </>

      )}

    </div>
  );

}
