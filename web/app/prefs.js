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
  autoplayBrief: false
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


export function writePrefs(patch) {

  const next = { ...readPrefs(), ...patch };

  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing. Nothing here is important enough to fail loudly over.
  }

  if ("theme" in patch) applyTheme(next.theme);

  window.dispatchEvent(new CustomEvent("pos-prefs", { detail: next }));

  return next;

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
