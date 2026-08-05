"use client";

import { readPrefs } from "./prefs.js";


// Read-aloud, with two engines and a clear default.
//
// The device engine (`speechSynthesis`) was the whole implementation until it
// ran into a wall: iOS does not hand downloaded Enhanced or Premium voices to
// web pages. Whatever gets installed in Settings, a web page on an iPhone sees
// the small built-in set plus Apple's novelty voices — which is why the picker
// was offering Bubbles and Cellos. No amount of filtering fixes the underlying
// quality, so the default is now server-generated neural audio and the device
// engine is the offline fallback.


const STORAGE_KEY = "pos_voice_uri";

// Not "voices" in any useful sense — they are 1980s Mac joke sounds that ship
// in the same list as the real ones. Nothing here should ever read a brief.
const NOVELTY = [
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos",
  "deranged", "good news", "jester", "organ", "superstar", "trinoids",
  "whisper", "wobble", "zarvox", "junior", "kathy", "ralph", "fred",
  "princess", "bruce", "agnes", "hysterical", "pipe organ", "eddy", "flo",
  "grandma", "grandpa", "reed", "rocko", "sandy", "shelley"
];

const PREFERRED_NAMES = ["ava", "samantha", "allison", "susan", "zoe", "karen", "moira"];


export const NEURAL_VOICES = [
  { id: "sage",    name: "Sage",    blurb: "Even and unhurried. The best default for a long brief." },
  { id: "alloy",   name: "Alloy",   blurb: "Neutral and level." },
  { id: "ash",     name: "Ash",     blurb: "Lower, steadier. Good in noise." },
  { id: "coral",   name: "Coral",   blurb: "Warmer, a little brighter." },
  { id: "nova",    name: "Nova",    blurb: "Quick and crisp." },
  { id: "onyx",    name: "Onyx",    blurb: "Deep and slow." },
  { id: "echo",    name: "Echo",    blurb: "Flat and matter-of-fact." },
  { id: "fable",   name: "Fable",   blurb: "More inflection, storytelling tone." },
  { id: "shimmer", name: "Shimmer", blurb: "Softer, higher." }
];


function supported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}


function isNovelty(name) {
  const n = name.toLowerCase();
  return NOVELTY.some(bad => n === bad || n.startsWith(`${bad} `) || n.includes(`(${bad})`));
}


function qualityLabel(name) {
  const n = name.toLowerCase();
  if (n.includes("premium")) return "Premium";
  if (n.includes("enhanced")) return "Enhanced";
  if (n.includes("neural") || n.includes("natural")) return "Neural";
  if (n.includes("compact")) return "Compact";
  return "";
}


function score(voice) {

  const name = voice.name.toLowerCase();

  let s = 0;

  if (name.includes("premium")) s += 60;
  if (name.includes("enhanced")) s += 50;
  if (name.includes("natural") || name.includes("neural")) s += 45;

  const rank = PREFERRED_NAMES.findIndex(p => name.includes(p));
  if (rank !== -1) s += 30 - rank * 2;

  if (voice.localService === false) s += 15;
  if (voice.lang === "en-US") s += 5;

  if (name.includes("compact")) s -= 40;

  return s;

}


export function listVoices() {

  if (!supported()) return [];

  return window.speechSynthesis
    .getVoices()
    .filter(v => v.lang?.toLowerCase().startsWith("en"))
    .filter(v => !isNovelty(v.name))
    .sort((a, b) => score(b) - score(a))
    .map(v => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      quality: qualityLabel(v.name)
    }));

}


export function getSavedVoiceURI() {
  if (typeof window === "undefined") return null;
  try {
    return readPrefs().deviceVoiceURI || window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}


export function saveVoiceURI(uri) {
  try { window.localStorage.setItem(STORAGE_KEY, uri); } catch { /* private mode */ }
}


function resolveVoice() {

  if (!supported()) return null;

  const voices = window.speechSynthesis
    .getVoices()
    .filter(v => v.lang?.toLowerCase().startsWith("en"))
    .filter(v => !isNovelty(v.name));

  if (voices.length === 0) return null;

  const savedURI = getSavedVoiceURI();
  const saved = savedURI && voices.find(v => v.voiceURI === savedURI);

  return saved || voices.slice().sort((a, b) => score(b) - score(a))[0] || null;

}


// ---------------------------------------------------------------- device engine


export function speakWith(text, voiceURI, rate = 1) {

  if (!supported()) return;

  window.speechSynthesis.cancel();

  const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceURI);

  const utterance = new SpeechSynthesisUtterance(text);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }

  utterance.rate = rate * 0.97;

  window.speechSynthesis.speak(utterance);

}


function speakOnDevice(text, { rate, onEnd }) {

  if (!supported()) return false;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  const voice = resolveVoice();

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }

  // Slightly under default reads far less clipped and mechanical.
  utterance.rate = rate * 0.97;
  utterance.pitch = 1.0;

  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }

  window.speechSynthesis.speak(utterance);

  return true;

}


// ---------------------------------------------------------------- neural engine

// Ten milliseconds of silence. iOS only lets audio start from inside a user
// gesture, and the neural path has to await a network round trip first — by
// the time the audio exists the gesture is long over and play() is refused.
// Playing this synchronously on the click unlocks the element, so assigning
// the real source afterwards is allowed.
const SILENCE =
  "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA";

let element = null;
let objectUrl = null;
let controller = null;


function audio() {

  if (!element) {
    element = new Audio();
    element.preload = "auto";
  }

  return element;

}


function releaseUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}


// Lock-screen and Control Centre controls, so a brief can be paused without
// unlocking the phone — the entire point of reading these aloud while walking.
function describeToOS(title, onStop) {

  if (!("mediaSession" in navigator)) return;

  try {

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: title || "Brief",
      artist: "PersonalOS"
    });

    navigator.mediaSession.setActionHandler("play", () => audio().play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => audio().pause());
    navigator.mediaSession.setActionHandler("stop", onStop);

  } catch {
    // Metadata is decoration; never let it break playback.
  }

}


export function stop() {

  if (supported()) window.speechSynthesis.cancel();

  if (controller) {
    controller.abort();
    controller = null;
  }

  if (element) {
    element.pause();
    element.removeAttribute("src");
    element.load();
  }

  releaseUrl();

}


export function isSpeaking() {

  if (supported() && window.speechSynthesis.speaking) return true;

  return Boolean(element && !element.paused && !element.ended);

}


// Returns how it actually played, so the caller can tell the user when it
// silently fell back rather than leaving them wondering why it sounds worse.
export async function speak(text, { onEnd, onState, title } = {}) {

  const prefs = readPrefs();

  stop();

  const finish = () => {
    releaseUrl();
    onEnd?.();
  };


  if (prefs.engine !== "neural") {
    onState?.("speaking");
    speakOnDevice(text, { rate: prefs.rate, onEnd: finish });
    return { engine: "device" };
  }


  const el = audio();

  // Must happen synchronously, still inside the click that called us.
  el.src = SILENCE;
  el.play().catch(() => {});

  onState?.("loading");

  controller = new AbortController();

  try {

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: prefs.voice, speed: prefs.rate }),
      signal: controller.signal
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `Speech failed (${res.status}).`);
    }

    const blob = await res.blob();

    releaseUrl();
    objectUrl = URL.createObjectURL(blob);

    el.src = objectUrl;
    el.onended = () => { onState?.("idle"); finish(); };
    el.onerror = () => { onState?.("idle"); finish(); };

    describeToOS(title, () => { stop(); onState?.("idle"); });

    await el.play();

    onState?.("speaking");

    return { engine: "neural" };

  } catch (error) {

    if (error.name === "AbortError") return { engine: "aborted" };

    // Offline, or the key is missing, or OpenAI is down. A worse voice beats
    // silence when he is out walking.
    onState?.("speaking");
    speakOnDevice(text, { rate: prefs.rate, onEnd: finish });

    return { engine: "device", fellBack: true, reason: error.message };

  } finally {

    controller = null;

  }

}
