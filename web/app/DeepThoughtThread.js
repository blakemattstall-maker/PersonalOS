"use client";

import { useState, useTransition, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { respondToThreadAction, buildPlanAction, resolveDeepThought, resetBuildAction } from "./actions.js";
import { PLAN_TOOLS } from "./planTools.js";
import VoiceInput from "./VoiceInput.js";
import { DeepThoughtBody } from "./shared.js";
import ReadAloud from "./ReadAloud.js";
import { readPrefs, subscribeToPrefs } from "./prefs.js";
import { ItemCard, btn, field } from "./ui.js";


// subscribeToPrefs now lives in prefs.js, shared with SettingsPanel — it is the
// same subscription, and keeping two copies meant only one of them invalidated
// the snapshot cache that module now keeps.
//
// These two snapshots stay local because they return a string. A primitive is
// compared by value, so recomputing it per render is safe without going through
// that cache.
const getSelfNameServerSnapshot = () => "PersonalOS";
const getSelfNameSnapshot = () => readPrefs().displayName || "PersonalOS";


function Dots() {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden="true">
      <span className="pos-dot" />
      <span className="pos-dot" />
      <span className="pos-dot" />
    </span>
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

  // The one real failure signal available: the server resets thread_status
  // from "building" back to "ready_to_build" when the background job throws
  // (see runPlanBuild's catch in tools/thread.js). Nothing else marks a
  // failure — there is no error field, because the client that started the
  // build already got its response before the crash happens.
  //
  // Without this, that transition is silent: isBuilding flips false, the
  // polling effect below stops, and the button just reappears with no
  // indication a build was ever attempted, let alone that it failed. That
  // silence is exactly what shipped as a real bug (a dropped parameter threw
  // inside the background job) and is worth guarding against even now that
  // bug is fixed — any future failure in there would look identical.
  const [buildFailed, setBuildFailed] = useState(false);

  // Both of the above are derived from a *transition* in isBuilding, not from
  // its current value, so they need one bit of history. That history is state
  // compared during render rather than a ref written from an effect.
  //
  // The effect version called setBuildFailed/setBuildStalled synchronously in
  // its body, which is React's "adjust state when a prop changes" problem solved
  // the expensive way: the component painted with the stale value first and then
  // re-rendered, and it is what react-hooks/set-state-in-effect flags. Comparing
  // during render is the documented shape for this — React discards the
  // in-progress render and redoes it immediately, before the browser paints
  // anything, so there is no intermediate frame and no cascading render.
  const [buildingLastRender, setBuildingLastRender] = useState(isBuilding);

  if (buildingLastRender !== isBuilding) {

    setBuildingLastRender(isBuilding);

    // Entering a build clears both flags. Leaving one without having reached
    // "active" — the status a successful build sets — is the failure signal.
    setBuildStalled(false);
    setBuildFailed(!isBuilding && thought.thread_status !== "active");

  }

  // buildPlan() now detects a previous failed attempt itself (it keys off
  // project_id, set the moment the project is created, not thread_status) and
  // refuses to build again — returning immediately with `duplicate: true`
  // rather than ever entering "building". That response never touches
  // thread_status, so the polling effect below has nothing to see; this is
  // the one case that has to be handled from the click itself.
  const [buildResultMessage, setBuildResultMessage] = useState(null);

  const [showTools, setShowTools] = useState(false);

  // Cosmetic label only. useSyncExternalStore rather than a state-plus-effect
  // pair: the third argument is the snapshot used for both the server render
  // and React's first client render, so hydration compares "PersonalOS"
  // against "PersonalOS" even when a custom name is actually set — the real
  // value shows up the moment React re-renders after hydrating, without ever
  // asserting a value the server couldn't have known.
  const selfName = useSyncExternalStore(
    subscribeToPrefs,
    getSelfNameSnapshot,
    getSelfNameServerSnapshot
  );

  const [tools, setTools] = useState(() =>
    Object.fromEntries(Object.entries(PLAN_TOOLS).map(([k, v]) => [k, v.default]))
  );

  // The build runs in the background on the server now, so the page has to
  // come back and look. Stops as soon as thread_status moves off "building".
  //
  // Only the timers live here now — the two flags they used to also maintain are
  // set from the transition check above. This is the half of the old effect that
  // is genuinely an effect: it drives things outside React (an interval and a
  // timeout) and setBuildStalled is called from the timeout's callback, not from
  // the effect body, which is the distinction the lint rule is drawing.
  //
  // thought.thread_status is no longer a dependency because isBuilding is
  // derived from it: while isBuilding holds, the status is "building" by
  // definition, so the only thing the extra dependency ever did was restart the
  // 90-second stall timer when router.refresh() brought back an identical
  // status.
  useEffect(() => {

    if (!isBuilding) return;

    const timer = setInterval(() => router.refresh(), 4000);

    // A build normally lands in ~20-45s. If it's still going well past
    // that, the server-side work was probably killed — offer a way out
    // rather than spinning forever.
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

    setShowTools(false);
    setBuildResultMessage(null);
    setBuildFailed(false);

    startTransition(async () => {

      const result = await buildPlanAction(thought.id, tools);

      // A duplicate is a complete answer on its own — nothing was started,
      // so there's nothing for the polling effect to watch for.
      if (result?.duplicate) {
        setBuildResultMessage(result.message);
      }

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
    <ItemCard
      kind="thought"
      title={thought.topic}
      waiting={thought.status !== "thinking"}
    >

      {thought.status === "thinking" ? (

        <p className="mt-3 flex items-center gap-2 text-[0.9rem] text-ink-soft">
          Still working this through <Dots />
        </p>

      ) : (

        <>
          <DeepThoughtBody content={thought.content} />

          {turns.length > 0 && (

            <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`rounded-item px-3.5 py-2.5 text-[0.87rem] leading-relaxed ${
                    turn.role === "user"
                      ? "bg-[var(--sunken)] text-ink"
                      : "bg-moss-wash text-ink"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[0.65rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                      {turn.role === "user" ? "You" : selfName}
                    </span>
                    {turn.role === "assistant" && (
                      <ReadAloud text={turn.message} title={thought.topic} />
                    )}
                  </div>
                  <p>{turn.message}</p>
                </div>
              ))}
            </div>

          )}

          {isPending && (
            <div className="mt-3 flex items-center gap-2 text-[0.8rem] text-ink-soft">
              <span className="text-[0.65rem] font-medium uppercase tracking-[0.08em]">
                {selfName}
              </span>
              <Dots />
            </div>
          )}

          {isBuilding ? (

            /* Sunken, not ember. The app is working — nothing is waiting on
               the user here, and lighting this up in the one colour that means
               "act on me" would teach him to ignore it. */
            <div className="mt-4 rounded-item bg-[var(--sunken)] px-4 py-3.5">
              <div className="pos-display flex items-center gap-2 text-[0.95rem] text-ink">
                Building your plan <Dots />
              </div>
              <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-soft">
                Writing the workback schedule and creating the tasks and calendar
                events. This takes up to a minute — it&apos;ll appear under Projects
                on its own.
              </p>

              {buildStalled && (
                <div className="mt-3 border-t border-[var(--line)] pt-3">
                  <p className="text-[0.8rem] text-ink-soft">
                    This is taking longer than it should.
                  </p>
                  <button
                    onClick={handleResetBuild}
                    disabled={isPending}
                    className={`${btn("quiet")} mt-2`}
                  >
                    Cancel and try again
                  </button>
                </div>
              )}
            </div>

          ) : (

            <>
              {buildResultMessage && (
                // The immediate, synchronous answer from buildPlan() itself —
                // covers the case where it refused to start at all because a
                // previous attempt (this one or an earlier failure) already
                // has a project. Distinct from buildFailed below, which is
                // inferred later from polling a build that DID start.
                <div className="mt-3 rounded-item bg-[var(--sunken)] px-4 py-3.5">
                  <p className="text-[0.87rem] leading-relaxed text-ink">{buildResultMessage}</p>
                </div>
              )}

              {buildFailed && (
                /* Ember is allowed here: a failed build genuinely is waiting
                   on him to retry it. */
                <div className="mt-3 rounded-item bg-ember-wash px-4 py-3.5">
                  <p className="pos-display text-[0.95rem] text-ink">
                    That build didn&apos;t finish.
                  </p>
                  <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-soft">
                    Something failed partway through. Safe to try again below —
                    if it had already started creating the project, retrying
                    will point you at that one instead of making a second.
                  </p>
                </div>
              )}

              {/* A textarea, not an input: replies here are paragraphs, and a
                  single-line box that scrolls sideways makes it impossible to
                  reread what you just said before sending it. */}
              <div className="mt-4 flex items-end gap-2">

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, shift+Enter breaks the line.
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  rows={2}
                  placeholder="Reply, or record below"
                  disabled={isPending}
                  aria-label="Your reply"
                  className={field("flex-1 resize-y leading-relaxed")}
                />

                <button
                  onClick={handleSend}
                  disabled={isPending || !input.trim()}
                  className={`${btn("ember", "md")} shrink-0`}
                >
                  {isPending ? <Dots /> : "Send"}
                </button>

              </div>

              {/* Appends rather than replaces, so several bursts of thinking
                  can be stacked up before sending — and anything already typed
                  isn't destroyed by hitting record. */}
              <div className="mt-2">
                <VoiceInput
                  disabled={isPending}
                  onTranscript={(text) =>
                    setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text))
                  }
                />
              </div>

              {/* What the build is allowed to touch. Shown before the build,
                  not buried in settings, because the right answer differs per
                  plan — some want the whole toolbox, some want the thinking
                  and nothing written anywhere. */}
              {showTools && lastAction === "propose_plan" && (

                <div className="mt-3 rounded-item bg-[var(--sunken)] p-4">

                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                    What should it be allowed to do?
                  </p>

                  <div className="mt-3 space-y-2.5">
                    {Object.entries(PLAN_TOOLS).map(([key, tool]) => (
                      <label key={key} className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={!!tools[key]}
                          onChange={(e) => setTools(t => ({ ...t, [key]: e.target.checked }))}
                          disabled={isPending}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--moss)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[0.87rem] text-ink">{tool.label}</span>
                          <span className="block text-[0.78rem] leading-snug text-ink-soft">{tool.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <button
                    onClick={handleBuildPlan}
                    disabled={isPending}
                    className={`${btn("solid", "md")} mt-4`}
                  >
                    {isPending ? "Starting…" : "Build it"}
                  </button>

                </div>

              )}

              <div className="mt-4 flex flex-wrap gap-2">

                {lastAction === "propose_plan" && (
                  <button
                    onClick={() => setShowTools(s => !s)}
                    disabled={isPending}
                    className={btn("solid")}
                  >
                    {isPending ? "Starting…" : showTools ? "Hide options" : "Build the plan"}
                  </button>
                )}

                <button
                  onClick={handleResolve}
                  disabled={isPending}
                  className={btn("quiet")}
                >
                  Mark resolved
                </button>

              </div>
            </>

          )}
        </>

      )}

    </ItemCard>
  );

}
