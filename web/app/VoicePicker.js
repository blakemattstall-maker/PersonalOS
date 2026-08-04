"use client";

import { useEffect, useState } from "react";
import { listVoices, getSavedVoiceURI, saveVoiceURI, speakWith } from "./speech.js";


// Rather than telling the user which iOS settings menu to dig through — menu
// names move between versions — just show whatever voices the device actually
// reports and let them hear each one. Whatever they pick is what read-aloud
// uses everywhere.
export default function VoicePicker() {

  const [voices, setVoices] = useState([]);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);


  useEffect(() => {

    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    let done = false;

    const load = () => {
      const list = listVoices();
      if (list.length === 0) return false;
      setVoices(list);
      setSelected(getSavedVoiceURI() || list[0]?.voiceURI || "");
      done = true;
      return true;
    };

    // The voice list fills in asynchronously, but "voiceschanged" may already
    // have fired before this listener attaches — on a reload that left the
    // picker permanently empty. Listen *and* retry briefly, whichever wins.
    window.speechSynthesis.addEventListener("voiceschanged", load);

    load();

    const poll = setInterval(() => {
      if (done || load()) clearInterval(poll);
    }, 250);

    const giveUp = setTimeout(() => clearInterval(poll), 5000);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      clearInterval(poll);
      clearTimeout(giveUp);
    };

  }, []);


  if (voices.length === 0) return null;


  const choose = (uri) => {
    setSelected(uri);
    saveVoiceURI(uri);
    speakWith("This is how I'll read things back to you.", uri);
  };


  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-6">

      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between text-sm font-medium uppercase tracking-wide text-muted hover:text-accent"
      >
        <span>Reading voice</span>
        <span className="text-xs normal-case">{open ? "Hide" : `${voices.length} available`}</span>
      </button>

      {open && (
        <div className="mt-4">

          <p className="text-xs text-muted">
            Tap one to hear it. Higher-quality voices show up here once you
            download them on your device — anything marked Enhanced, Premium or
            Neural will sound markedly better than the default.
          </p>

          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {voices.map(v => (
              <button
                key={v.voiceURI}
                onClick={() => choose(v.voiceURI)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                  v.voiceURI === selected
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border text-muted hover:border-accent"
                }`}
              >
                <span>{v.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted">
                  {v.quality ? `${v.quality} · ` : ""}{v.lang}
                </span>
              </button>
            ))}
          </div>

        </div>
      )}

    </div>
  );

}
