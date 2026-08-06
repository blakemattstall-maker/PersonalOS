"use client";

import { useEffect, useState } from "react";
import { readPrefs, writePrefs } from "./prefs.js";
import { NEURAL_VOICES, VOICE_PREVIEW_TEXT, listVoices, speakWith, playPreset, stop } from "./speech.js";
import { saveSettingsAction, getDiagnosticsAction, sendTestPushAction } from "./actions.js";
import PushSetup from "./PushSetup.js";


const SAMPLE = VOICE_PREVIEW_TEXT;


const LEVELS = [
  { id: "silent", name: "Silent", blurb: "Never buzzes your phone. Everything still shows up here when you open it." },
  { id: "digest", name: "Daily digest only", blurb: "One notification a day, at most. Nothing else gets through." },
  { id: "digest_plus_urgent", name: "Digest + urgent", blurb: "The daily digest, plus genuinely time-sensitive things: a large unexpected charge, a paycheck, something due today." },
  { id: "everything", name: "Everything", blurb: "Anything the observer thinks is worth saying. Expect several a day." }
];


function Section({ title, children, aside }) {
  return (
    <section className="mt-4 rounded-card bg-card p-5 shadow-lift">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="pos-display text-[1.05rem] text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}


function Choice({ selected, onClick, name, blurb, trailing }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start justify-between gap-3 rounded-item border px-3.5 py-3 text-left ${
        selected ? "border-ink bg-[var(--sunken)]" : "border-[var(--line)] hover:border-ink"
      }`}
    >
      <span className="min-w-0">
        <span className={`block text-sm ${selected ? "text-ink" : "text-ink-soft"}`}>{name}</span>
        {blurb && <span className="mt-0.5 block text-xs text-ink-soft">{blurb}</span>}
      </span>
      {trailing && <span className="shrink-0 text-xs text-ink-soft">{trailing}</span>}
    </button>
  );
}


export default function SettingsPanel({ initialSettings, initialDiagnostics }) {

  const [prefs, setPrefs] = useState(null);
  const [deviceVoices, setDeviceVoices] = useState([]);

  const [level, setLevel] = useState(initialSettings?.interruption_level || "digest_plus_urgent");
  const [levelNote, setLevelNote] = useState(null);
  const [savingLevel, setSavingLevel] = useState(false);

  const [diag, setDiag] = useState(initialDiagnostics);
  const [refreshing, setRefreshing] = useState(false);
  const [pushResult, setPushResult] = useState(null);

  const [previewing, setPreviewing] = useState(null);


  // Prefs live in localStorage, which the server render can't see, so the
  // panel paints from defaults for one frame and then corrects itself. Doing
  // it the other way round would mean a settings page that flashes the wrong
  // state on every visit.
  useEffect(() => {
    setPrefs(readPrefs());
    return () => stop();
  }, []);


  useEffect(() => {

    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const load = () => {
      const list = listVoices();
      if (list.length) setDeviceVoices(list);
    };

    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);

    const poll = setInterval(load, 300);
    const giveUp = setTimeout(() => clearInterval(poll), 4000);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      clearInterval(poll);
      clearTimeout(giveUp);
    };

  }, []);


  if (!prefs) return null;


  const update = (patch) => setPrefs(writePrefs(patch));


  const previewNeural = (voice) => {

    update({ voice });
    setPreviewing(voice);

    // A static clip, not a live generation — see speech.js's playPreset for
    // why this doesn't cost an OpenAI call on every tap while browsing.
    playPreset(voice, 1, { onEnd: () => setPreviewing(null) });

  };


  const chooseLevel = async (next) => {

    setLevel(next);
    setSavingLevel(true);
    setLevelNote(null);

    const result = await saveSettingsAction({ interruption_level: next });

    setSavingLevel(false);
    setLevelNote(result?.success ? "Saved." : result?.error || "Couldn't save.");

  };


  const refreshDiag = async () => {
    setRefreshing(true);
    setDiag(await getDiagnosticsAction());
    setRefreshing(false);
  };


  const testPush = async () => {
    setPushResult("sending");
    const result = await sendTestPushAction();
    setPushResult(result?.sent > 0 ? `Sent to ${result.sent} device(s).` : result?.skipped || "Nothing subscribed.");
  };


  return (
    <>

      <Section title="Appearance">
        <div className="mt-4 grid grid-cols-3 gap-2">
          {["system", "light", "dark"].map(t => (
            <button
              key={t}
              onClick={() => update({ theme: t })}
              className={`rounded-item border px-3.5 py-2.5 text-[0.85rem] capitalize ${
                prefs.theme === t ? "border-ink bg-[var(--sunken)] text-ink" : "border-[var(--line)] text-ink-soft hover:border-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Section>


      <Section
        title="Reading voice"
        aside={<span className="text-xs text-ink-soft">{prefs.engine === "neural" ? "Neural" : "Device"}</span>}
      >

        <div className="mt-4 space-y-2">

          <Choice
            selected={prefs.engine === "neural"}
            onClick={() => update({ engine: "neural" })}
            name="Neural (recommended)"
            blurb="Generated on the server. Sounds like a person, works the same on every device, plays from the lock screen. Needs a connection."
          />

          <Choice
            selected={prefs.engine === "device"}
            onClick={() => update({ engine: "device" })}
            name="Device voice"
            blurb="Free and works offline. iPhone hides its downloaded Premium voices from web pages, so this is limited to the built-in ones."
          />

        </div>


        {prefs.engine === "neural" ? (

          <div className="mt-5">
            <p className="text-xs text-ink-soft">Tap one to hear it.</p>
            <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {NEURAL_VOICES.map(v => (
                <Choice
                  key={v.id}
                  selected={prefs.voice === v.id}
                  onClick={() => previewNeural(v.id)}
                  name={v.name}
                  blurb={v.blurb}
                  trailing={previewing === v.id ? "…" : null}
                />
              ))}
            </div>
          </div>

        ) : (

          <div className="mt-5">
            <p className="text-xs text-ink-soft">
              {deviceVoices.length === 0
                ? "No usable device voices reported yet."
                : "Tap one to hear it. Apple's novelty voices are filtered out."}
            </p>
            <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {deviceVoices.map(v => (
                <Choice
                  key={v.voiceURI}
                  selected={prefs.deviceVoiceURI === v.voiceURI}
                  onClick={() => {
                    update({ deviceVoiceURI: v.voiceURI });
                    speakWith(SAMPLE, v.voiceURI, prefs.rate);
                  }}
                  name={v.name}
                  trailing={`${v.quality ? `${v.quality} · ` : ""}${v.lang}`}
                />
              ))}
            </div>
          </div>

        )}


        <div className="mt-5 border-t border-[var(--line)] pt-4">

          <label className="flex items-center justify-between text-sm text-ink">
            <span>Speed</span>
            <span className="text-ink-soft">{prefs.rate.toFixed(2)}×</span>
          </label>

          <input
            type="range"
            min="0.7"
            max="1.6"
            step="0.05"
            value={prefs.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--moss)]"
          />

          <button
            onClick={() => {
              if (prefs.engine === "neural") {
                // The preset's own fixed speed, adjusted by playbackRate —
                // a slight pitch shift versus a true regeneration at this
                // speed, traded for previewing instantly at zero cost.
                playPreset(prefs.voice, prefs.rate);
              } else {
                speakWith(SAMPLE, prefs.deviceVoiceURI, prefs.rate);
              }
            }}
            className="mt-3 rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink-soft hover:border-ink hover:text-ink"
          >
            Hear this speed
          </button>

        </div>


        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <button
            onClick={() => update({ autoplayBrief: !prefs.autoplayBrief })}
            className="flex w-full items-start justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-sm text-ink">Read the brief when I open the app</span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                Starts playing as soon as the dashboard loads. Your phone may
                still require one tap first.
              </span>
            </span>
            <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs ${
              prefs.autoplayBrief ? "border-moss text-moss" : "border-[var(--line)] text-ink-soft"
            }`}>
              {prefs.autoplayBrief ? "On" : "Off"}
            </span>
          </button>
        </div>

      </Section>


      <PushSetup />


      <Section title="How much it interrupts you">

        <div className="mt-4 space-y-2">
          {LEVELS.map(l => (
            <Choice
              key={l.id}
              selected={level === l.id}
              onClick={() => chooseLevel(l.id)}
              name={l.name}
              blurb={l.blurb}
            />
          ))}
        </div>

        {savingLevel && <p className="mt-3 text-xs text-ink-soft">Saving…</p>}
        {levelNote && !savingLevel && <p className="mt-3 text-xs text-ink-soft">{levelNote}</p>}

        {initialSettings?.persisted === false && (
          <p className="mt-3 text-xs text-ink-soft">
            This one needs a database table that doesn&apos;t exist yet — run
            <span className="text-ink"> docs/schema-settings.sql </span>
            in Supabase. Until then it behaves as &ldquo;Digest + urgent&rdquo;.
          </p>
        )}

      </Section>


      <Section
        title="Diagnostics"
        aside={
          <button
            onClick={refreshDiag}
            className="text-xs text-ink-soft hover:text-ink"
          >
            {refreshing ? "Checking…" : "Refresh"}
          </button>
        }
      >

        {!diag?.success ? (

          <p className="mt-4 text-sm text-ink-soft">Couldn&apos;t reach the backend.</p>

        ) : (

          <div className="mt-4 space-y-4 text-sm">

            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Location</div>
              <p className="mt-1 text-ink">{diag.location.verdict}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {diag.location.points} point{diag.location.points === 1 ? "" : "s"},
                {" "}{diag.location.places} place{diag.location.places === 1 ? "" : "s"}
                {diag.location.lastPointAt
                  ? ` · last ${diag.location.lastPointAgeHours}h ago`
                  : " · never received"}
                {" "}· {diag.location.deliveryAttempts} delivery attempt{diag.location.deliveryAttempts === 1 ? "" : "s"} logged
              </p>
            </div>

            <div className="border-t border-[var(--line)] pt-3">
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Notifications</div>
              <p className="mt-1 text-ink">{diag.push.verdict}</p>
              <button
                onClick={testPush}
                className="mt-2 rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink-soft hover:border-ink hover:text-ink"
              >
                {pushResult === "sending" ? "Sending…" : "Send a test notification"}
              </button>
              {pushResult && pushResult !== "sending" && (
                <p className="mt-2 text-xs text-ink-soft">{pushResult}</p>
              )}
            </div>

            <div className="border-t border-[var(--line)] pt-3">
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Background jobs</div>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                <li>Morning brief — {diag.jobs.morningBrief.lastAt ? `${diag.jobs.morningBrief.ageHours}h ago` : "never run"}</li>
                <li>Daily review — {diag.jobs.reviewIntentions.lastAt ? `${diag.jobs.reviewIntentions.ageHours}h ago` : "never run"}</li>
              </ul>
            </div>

            {/* Supabase DDL can't be run from code, so every schema change is
                a .sql file pasted in by hand — and every feature that depends
                on a pending one degrades silently instead of failing. Without
                this panel the only way to know retrieval memory was off was to
                remember that the migration was never run. */}
            {diag.schema && (
              <div className="border-t border-[var(--line)] pt-3">
                <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Database migrations</div>
                <p className={`mt-1 ${diag.schema.pending?.length ? "text-ember" : "text-ink"}`}>
                  {diag.schema.verdict}
                </p>
                {diag.schema.pending?.length > 0 && (
                  <ul className="mt-2 space-y-2 text-xs text-ink-soft">
                    {diag.schema.pending.map(m => (
                      <li key={m.file}>
                        <span className="text-ink">{m.file.replace("docs/", "")}</span>
                        {" — "}{m.purpose}
                        <div className="mt-0.5">{m.breaksWithout}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <details className="border-t border-[var(--line)] pt-3">
              <summary className="cursor-pointer text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                What it knows about you
              </summary>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-soft">
                {Object.entries(diag.counts).map(([table, n]) => (
                  <li key={table} className="flex justify-between">
                    <span>{table.replace(/_/g, " ")}</span>
                    <span className="text-ink">{n ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </details>

          </div>

        )}

      </Section>

    </>
  );

}
