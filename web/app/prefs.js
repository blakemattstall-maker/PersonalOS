"use client";

// Preferences the browser acts on, kept in the browser.
//
// Reading voice, speed, autoplay and light/dark are all decisions made at the
// moment of rendering or playing. Round-tripping them to Supabase would add a
// network hop to every page load and break them whenever the backend is slow,
// and they are worth nothing to the nightly cron. The one setting the server
// genuinely needs — how much the app may interrupt — lives in app_settings
// instead and is edited through the API.

const KEY = "pos_prefs";

export const DEFAULTS = {
  theme: "system",        // system | dark | light
  engine: "neural",       // neural | device
  voice: "sage",          // an OpenAI voice when engine is neural
  deviceVoiceURI: null,   // a SpeechSynthesis voiceURI when engine is device
  rate: 1.0,
  autoplayBrief: false,
  // Cosmetic label swap only — see the note in SettingsPanel.js. Empty means
  // "PersonalOS".
  displayName: ""
};


export function readPrefs() {

  if (typeof window === "undefined") return { ...DEFAULTS };

  try {

    const raw = window.localStorage.getItem(KEY);

    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };

  } catch {

    return { ...DEFAULTS };

  }

}


// Mirror the two the desk device also needs.
//
// Fire-and-forget on purpose: the browser's own playback already uses
// localStorage and must not wait on, or be broken by, a network call. This
// only exists so a voice chosen on the phone is the voice that comes out of
// the thing on the desk.
function syncVoiceToServer(prefs) {

  if (typeof window === "undefined") return;

  const body = {};

  if (prefs.voice) body.voice = prefs.voice;
  if (typeof prefs.rate === "number") body.speech_rate = prefs.rate;

  if (!Object.keys(body).length) return;

  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});

}


export function writePrefs(patch) {

  const next = { ...readPrefs(), ...patch };

  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing. Nothing here is important enough to fail loudly over.
  }

  if ("theme" in patch) applyTheme(next.theme);

  if ("voice" in patch || "rate" in patch) syncVoiceToServer(next);

  cached = null;

  window.dispatchEvent(new CustomEvent("pos-prefs", { detail: next }));

  return next;

}


// The useSyncExternalStore face of this module, for components that render from
// prefs rather than only writing them.
//
// The cache is the whole point and is not an optimisation. React calls
// getSnapshot on every render and compares the result with Object.is, so a
// getSnapshot that returned readPrefs() directly would hand back a fresh object
// every time and re-render forever — a hang, with no error anywhere. Components
// whose snapshot is a primitive (DeepThoughtThread's selfName is a string) are
// safe without this; anything reading the whole object is not.
let cached = null;

// Frozen and module-level so the server snapshot is one stable reference too —
// the same Object.is comparison applies during hydration.
const SERVER_SNAPSHOT = Object.freeze({ ...DEFAULTS });

export function prefsSnapshot() {

  if (typeof window === "undefined") return SERVER_SNAPSHOT;

  if (!cached) cached = readPrefs();

  return cached;

}

export function prefsServerSnapshot() {
  return SERVER_SNAPSHOT;
}


// Stable across renders on purpose: useSyncExternalStore resubscribes whenever
// this function's identity changes, so a literal defined inside a component
// would turn "subscribe once" into "subscribe on every render".
//
// `storage` is listened to as well as the app's own event because localStorage
// changes made in another tab fire only that one — without it, changing the
// reading voice in one tab left every other tab rendering the old choice until
// a reload.
export function subscribeToPrefs(callback) {

  const invalidate = () => {
    cached = null;
    callback();
  };

  window.addEventListener("pos-prefs", invalidate);
  window.addEventListener("storage", invalidate);

  return () => {
    window.removeEventListener("pos-prefs", invalidate);
    window.removeEventListener("storage", invalidate);
  };

}


// Written as a data attribute rather than a class so the same declaration can
// be produced by the blocking script in <head>, which has to run before first
// paint or the page flashes the wrong colour on every load.
export function applyTheme(theme) {

  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }

}
