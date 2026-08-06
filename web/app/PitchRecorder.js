"use client";

import { useRef, useState } from "react";
import { submitPitchAction, generatePitchTopicAction } from "./actions.js";
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

  // The explainer brief, when one was generated. Its presence is what switches
  // the grading rubric server-side — a generated topic is a comprehension
  // exercise, and grading it on persuasiveness would reward exactly the
  // confident hand-waving the exercise exists to catch.
  const [brief, setBrief] = useState(null);
  const [generating, setGenerating] = useState(false);

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


  const generateTopic = async () => {

    setGenerating(true);
    setError(null);

    try {

      const response = await generatePitchTopicAction();

      if (!response?.success) throw new Error(response?.error || "Couldn't come up with a topic.");

      setBrief(response);
      setTopic(response.topic);

    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }

  };


  const clearBrief = () => {
    setBrief(null);
    setTopic("");
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
        topic: topic.trim() || null,
        mode: brief ? "explainer" : "pitch",
        prompt: brief?.prompt || null
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

        <div className="space-y-3">

          {!brief && (

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">

              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What's this pitch about? (optional)"
                disabled={state === "recording"}
                className="w-full rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-[0.9rem] text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50 disabled:opacity-50"
              />

              <button
                onClick={generateTopic}
                disabled={generating || state === "recording"}
                title="Get a concept to research for a few minutes, then explain from memory"
                className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-ink-soft hover:border-ink hover:text-ink disabled:opacity-50"
              >
                {generating ? "Thinking…" : "Give me a topic"}
              </button>

            </div>

          )}

          {brief && (

            <div className="rounded-item bg-[var(--sunken)] p-4">

              <div className="flex items-start justify-between gap-3">

                <div className="min-w-0">
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                    Explainer · {brief.domain}
                  </p>
                  <h3 className="mt-1 font-medium text-ink">{brief.topic}</h3>
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={generateTopic}
                    disabled={generating || state === "recording"}
                    title="Different topic"
                    className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
                  >
                    {generating ? "…" : "↻"}
                  </button>
                  <button
                    onClick={clearBrief}
                    disabled={state === "recording"}
                    title="Back to a normal pitch"
                    className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ember hover:text-ember disabled:opacity-45"
                  >
                    ✕
                  </button>
                </div>

              </div>

              <p className="mt-3 text-sm leading-relaxed text-ink">{brief.prompt}</p>

              {brief.why_interesting && (
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">{brief.why_interesting}</p>
              )}

              {brief.research_hint && (
                <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs leading-relaxed text-ink-soft">
                  <span className="font-medium text-ink">Look up first:</span>{" "}
                  {brief.research_hint}
                </p>
              )}

              <p className="mt-3 text-xs text-ink-soft">
                Research it for a few minutes, then record without notes. Graded
                on whether you actually understood it — not on how good it sounded.
              </p>

            </div>

          )}

        </div>

      )}

      <div className="mt-3">

        {state === "idle" && (
          <button
            onClick={start}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-2.5 text-[0.88rem] font-medium text-paper transition-colors hover:opacity-90 disabled:opacity-45"
          >
            ● Record
          </button>
        )}

        {state === "recording" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={stop}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] border border-ember px-5 py-2.5 text-[0.88rem] font-medium text-ember"
            >
              ◼ Stop
            </button>
            <span className="text-sm text-ink-soft">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              {seconds >= MAX_SECONDS - 10 && " — stopping soon"}
            </span>
          </div>
        )}

        {state === "recorded" && (
          // Native <audio> controls render at an unpredictable width per
          // browser — wide enough on iOS Safari alone to collide with
          // buttons in the same row on a phone screen. Stacked on mobile,
          // side by side once there's room for it.
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <audio controls src={audioUrl} className="h-9 w-full sm:w-auto" />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={submit}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-2.5 text-[0.88rem] font-medium text-paper transition-colors hover:opacity-90 disabled:opacity-45"
              >
                Get feedback
              </button>
              <button
                onClick={reRecord}
                className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
              >
                Re-record
              </button>
            </div>
          </div>
        )}

        {state === "submitting" && (
          <span className="text-sm text-ink-soft">Transcribing and analyzing…</span>
        )}

      </div>

      {error && <p className="mt-3 text-sm text-ink">{error}</p>}

      {state === "done" && result && (

        <div className="mt-4 border-t border-[var(--line)] pt-4">

          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-ink-soft italic">&ldquo;{result.transcript}&rdquo;</p>
            <ReadAloud text={result.transcript} title="Pitch transcript" />
          </div>

          <FeedbackCard type="pitch" feedback={result.feedback} />

          <button
            onClick={reRecord}
            className="mt-4 rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink-soft hover:border-ink hover:text-ink"
          >
            Record another
          </button>

        </div>

      )}

    </div>
  );

}
