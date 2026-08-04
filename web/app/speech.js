"use client";

// Shared read-aloud plumbing. Browser speech synthesis is the ceiling here —
// Siri's own voices are not exposed to the web — so the wins available are
// picking the best voice actually installed, letting the user override that
// choice, and not clipping the delivery.

const STORAGE_KEY = "pos_voice_uri";

const PREFERRED_NAMES = ["ava", "samantha", "allison", "susan", "zoe", "karen", "moira"];


function supported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
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

  // Network voices generally beat the compact on-device ones.
  if (voice.localService === false) s += 15;
  if (voice.lang === "en-US") s += 5;

  // Compact is Apple's explicitly low-quality tier.
  if (name.includes("compact")) s -= 40;

  return s;

}


export function listVoices() {

  if (!supported()) return [];

  return window.speechSynthesis
    .getVoices()
    .filter(v => v.lang?.toLowerCase().startsWith("en"))
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
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}


export function saveVoiceURI(uri) {
  try { window.localStorage.setItem(STORAGE_KEY, uri); } catch { /* private mode */ }
}


// The user's explicit choice wins; otherwise fall back to the best-scoring
// voice installed, which is usually not the one the browser would default to.
export function resolveVoice() {

  if (!supported()) return null;

  const voices = window.speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith("en"));

  if (voices.length === 0) return null;

  const savedURI = getSavedVoiceURI();
  const saved = savedURI && voices.find(v => v.voiceURI === savedURI);

  return saved || voices.slice().sort((a, b) => score(b) - score(a))[0] || null;

}


function configure(utterance, voice) {
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  // Slightly under default reads far less clipped and mechanical.
  utterance.rate = 0.97;
  utterance.pitch = 1.0;
}


export function speak(text, { onEnd } = {}) {

  if (!supported()) return false;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  configure(utterance, resolveVoice());

  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }

  window.speechSynthesis.speak(utterance);

  return true;

}


export function speakWith(text, voiceURI) {

  if (!supported()) return;

  window.speechSynthesis.cancel();

  const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceURI);

  const utterance = new SpeechSynthesisUtterance(text);

  configure(utterance, voice);

  window.speechSynthesis.speak(utterance);

}


export function isSpeaking() {
  return supported() && window.speechSynthesis.speaking;
}


export function stop() {
  if (supported()) window.speechSynthesis.cancel();
}
