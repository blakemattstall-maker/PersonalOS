"use client";

import { useRef, useState } from "react";
import { transcribeAction } from "./actions.js";


// Record-and-transcribe, for anywhere text is typed but speaking is better.
//
// Built for deep-thinking replies specifically. iOS's built-in dictation is
// what that used to rely on, and it's the wrong tool for thinking out loud: it
// has effectively no punctuation model, and it decides you've finished the
// moment you pause — which is exactly what people do mid-thought. The pitch
// recorder already had a working audio path to a real transcription model, so
// this is that path, extracted.
//
// Deliberately transcribes to editable text rather than submitting: what comes
// back from thinking aloud usually wants a trim before it's sent.

const MAX_SECONDS = 180;
const MAX_BYTES = 2 * 1024 * 1024;

// iOS Safari never supported webm; Chrome/Android don't support mp4 for
// recording. Ask for whichever this browser actually has.
const CANDIDATE_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];


function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATE_TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) || "";
}


async function blobToBase64(blob) {

  const bytes = new Uint8Array(await blob.arrayBuffer());

  let binary = "";
  const chunk = 0x8000;

  // Spreading a large typed array into String.fromCharCode.apply overflows the
  // call stack — walk it in chunks.
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }

  return btoa(binary);

}


export default function VoiceInput({ onTranscript, disabled = false }) {

  const [state, setState] = useState("idle"); // idle | recording | working
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef("");
  const streamRef = useRef(null);
  const timerRef = useRef(null);


  const stopTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };


  const send = async (blob) => {

    if (blob.size > MAX_BYTES) {
      setError("That recording is too long to upload — try a shorter one.");
      setState("idle");
      return;
    }

    setState("working");

    try {

      const audio_base64 = await blobToBase64(blob);

      const result = await transcribeAction({
        audio_base64,
        mime_type: mimeRef.current || "audio/webm"
      });

      if (!result?.success) throw new Error(result?.error || "Couldn't transcribe that.");

      onTranscript(result.text);

      setState("idle");

    } catch (e) {
      setError(e.message);
      setState("idle");
    }

  };


  const start = async () => {

    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio.");
      return;
    }

    const mimeType = pickMimeType();

    if (mimeType === null) {
      setError("This browser doesn't support audio recording.");
      return;
    }

    try {

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      streamRef.current = stream;
      mimeRef.current = mimeType;
      chunksRef.current = [];

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        streamRef.current?.getTracks().forEach(t => t.stop());
        send(blob);
      };

      recorderRef.current = recorder;
      recorder.start();

      setSeconds(0);
      setState("recording");

      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (s + 1 >= MAX_SECONDS) {
            recorder.stop();
            stopTimer();
          }
          return s + 1;
        });
      }, 1000);

    } catch (e) {

      setError(
        e.name === "NotAllowedError"
          ? "Microphone permission was denied — check your browser settings."
          : e.message
      );

    }

  };


  const stop = () => {
    stopTimer();
    recorderRef.current?.stop();
  };


  return (
    <div className="flex flex-wrap items-center gap-2">

      {state === "idle" && (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          title="Record instead of typing"
          className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
        >
          ● Speak
        </button>
      )}

      {state === "recording" && (
        <>
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-ember px-3 py-1 text-[0.75rem] font-medium text-ember"
          >
            ◼ Stop
          </button>
          <span className="text-xs text-ink-soft">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            {seconds >= MAX_SECONDS - 15 && " — stopping soon"}
          </span>
        </>
      )}

      {state === "working" && (
        <span className="text-xs text-ink-soft">Transcribing…</span>
      )}

      {error && <span className="text-xs text-ink">{error}</span>}

    </div>
  );

}
