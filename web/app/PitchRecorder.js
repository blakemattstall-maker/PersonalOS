"use client";

import { useRef, useState } from "react";
import { submitPitchAction } from "./actions.js";
import ReadAloud from "./ReadAloud.js";
import FeedbackCard from "./FeedbackCard.js";


// Server rejects anything over 2MB decoded — Vercel's own request body cap on
// Hobby, not a design choice — so recording auto-stops well before that, and
// this checks again before ever uploading.
const MAX_SECONDS = 150;
const MAX_BYTES = 2 * 1024 * 1024;

// iOS Safari never supported webm; Chrome/Android don't support mp4 for
// recording. Ask for whichever this browser actually has, in preference order.
const CANDIDATE_TYPES = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm"
];


function pickMimeType() {

  if (typeof MediaRecorder === "undefined") return null;

  return CANDIDATE_TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) || "";

}


async function blobToBase64(blob) {

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const chunkSize = 0x8000;

  // Spreading a large typed array straight into String.fromCharCode.apply
  // overflows the call stack — this walks it in safe chunks instead.
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);

}


export default function PitchRecorder() {

  const [state, setState] = useState("idle"); // idle | recording | recorded | submitting | done
  const [seconds, setSeconds] = useState(0);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef("");
  const blobRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);


  const stopTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };


  const start = async () => {

    setError(null);
    setResult(null);

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
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {

        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "audio/webm" });

        blobRef.current = blob;

        setAudioUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });

        streamRef.current?.getTracks().forEach(t => t.stop());

        setState("recorded");

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
          ? "Microphone permission was denied — check your browser/site settings."
          : e.message
      );

    }

  };


  const stop = () => {
    stopTimer();
    recorderRef.current?.stop();
  };


  const reRecord = () => {
    blobRef.current = null;
    setResult(null);
    setError(null);
    setState("idle");
  };


  const submit = async () => {

    if (!blobRef.current) return;

    if (blobRef.current.size > MAX_BYTES) {
      setError("That recording is too large to upload — try a shorter one.");
      return;
    }

    setState("submitting");
    setError(null);

    try {

      const audio_base64 = await blobToBase64(blobRef.current);

      const response = await submitPitchAction({
        audio_base64,
        mime_type: mimeTypeRef.current || "audio/webm",
        topic: topic.trim() || null
      });

      if (!response?.success) throw new Error(response?.error || "Couldn't analyze that recording.");

      setResult(response);
      setState("done");

    } catch (e) {

      setError(e.message);
      setState("recorded");

    }

  };


  return (
    <div className="mt-4">

      {(state === "idle" || state === "recording") && (
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What's this pitch about? (optional)"
          disabled={state === "recording"}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
        />
      )}

      <div className="mt-3 flex items-center gap-3">

        {state === "idle" && (
          <button
            onClick={start}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            ● Record
          </button>
        )}

        {state === "recording" && (
          <>
            <button
              onClick={stop}
              className="rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent"
            >
              ◼ Stop
            </button>
            <span className="text-sm text-muted">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              {seconds >= MAX_SECONDS - 10 && " — stopping soon"}
            </span>
          </>
        )}

        {state === "recorded" && (
          <>
            <audio controls src={audioUrl} className="h-9" />
            <button
              onClick={submit}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Get feedback
            </button>
            <button
              onClick={reRecord}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted hover:border-accent hover:text-accent"
            >
              Re-record
            </button>
          </>
        )}

        {state === "submitting" && (
          <span className="text-sm text-muted">Transcribing and analyzing…</span>
        )}

      </div>

      {error && <p className="mt-3 text-sm text-foreground">{error}</p>}

      {state === "done" && result && (

        <div className="mt-4 border-t border-border pt-4">

          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted italic">&ldquo;{result.transcript}&rdquo;</p>
            <ReadAloud text={result.transcript} title="Pitch transcript" />
          </div>

          <FeedbackCard type="pitch" feedback={result.feedback} />

          <button
            onClick={reRecord}
            className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
          >
            Record another
          </button>

        </div>

      )}

    </div>
  );

}
