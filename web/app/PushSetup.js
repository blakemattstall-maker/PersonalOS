"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeToPushAction, getVapidKeyAction } from "./actions.js";


// iOS refuses web push unless the app was installed via Share -> Add to Home
// Screen. From a normal Safari tab the permission prompt still appears, is
// still granted, and notifications then silently never arrive — so the state is
// detected and explained up front rather than letting that happen.


const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);


// What this browser is capable of, which is a fact about the environment rather
// than something that happens over time — so it is read, not discovered by an
// effect that then writes it into state.
//
// It cannot be read during the server render, which is the only reason it looked
// like effect work: "checking" is what the server and React's first client render
// have to agree on, and useSyncExternalStore's third argument is exactly that.
// The snapshot is a string, so it needs no caching — a primitive compares by
// value under Object.is.
function capabilitySnapshot() {

  if (typeof window === "undefined") return "checking";

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";

  if (isIOS() && !isStandalone()) return "needs-install";

  return "ready";

}

const capabilityServerSnapshot = () => "checking";

// Nothing to subscribe to: neither the presence of PushManager nor iOS's
// display-mode survives a change without a reload. Stable identity so
// useSyncExternalStore does not resubscribe every render.
const subscribeToCapability = () => () => {};


function urlBase64ToUint8Array(base64) {

  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);

  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));

}


export default function PushSetup() {

  const capability = useSyncExternalStore(
    subscribeToCapability,
    capabilitySnapshot,
    capabilityServerSnapshot
  );

  // Everything that happens after the environment has been read: an existing
  // subscription found on disk, or the user pressing the button. `capability` is
  // the floor; this is anything that has moved on from it.
  const [progress, setProgress] = useState(null);

  const state = progress ?? capability;

  const [error, setError] = useState(null);


  // The one genuinely asynchronous question — is this device already registered?
  // setProgress is called from a promise callback, not from the effect body, and
  // "ready" is already the value being refined, so a registration failure needs
  // no handling beyond staying put.
  useEffect(() => {

    if (capability !== "ready" || progress) return;

    let cancelled = false;

    navigator.serviceWorker.register("/sw.js")
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => { if (sub && !cancelled) setProgress("subscribed"); })
      .catch(() => {});

    return () => { cancelled = true; };

  }, [capability, progress]);


  const enable = async () => {

    setError(null);
    setProgress("working");

    try {

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setProgress("denied");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { publicKey } = await getVapidKeyAction();

      if (!publicKey) throw new Error("Server has no push key configured.");

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await subscribeToPushAction(JSON.parse(JSON.stringify(subscription)));

      setProgress("subscribed");

    } catch (e) {
      setError(e.message);
      setProgress("ready");
    }

  };


  if (state === "checking") return null;


  return (
    <div className="mt-6 rounded-card bg-card p-5 shadow-lift">

      <h2 className="pos-display text-[1.05rem] text-ink">
        Notifications
      </h2>

      {/* Previously this rendered nothing on an unsupported browser. On a
          settings page that reads as a bug — the section the user came looking
          for simply isn't there — so it now says why. */}
      {state === "unsupported" && (
        <p className="mt-3 text-sm text-ink-soft">
          This browser can&apos;t receive push notifications. Open the app on
          your iPhone from the Home Screen icon to turn them on.
        </p>
      )}

      {state === "needs-install" && (
        <p className="mt-3 text-sm text-ink-soft">
          To get notifications on iPhone, this has to be installed as an app
          first: tap the Share button, then <span className="text-ink">Add to Home Screen</span>,
          and open it from there. Safari tabs can&apos;t receive them.
        </p>
      )}

      {state === "subscribed" && (
        <p className="mt-3 text-sm text-ink">
          On. You&apos;ll get one message a day at most, plus anything genuinely urgent.
        </p>
      )}

      {(state === "ready" || state === "working" || state === "denied") && (
        <>
          <p className="mt-3 text-sm text-ink-soft">
            One message a day at most, plus anything urgent — a large unexpected
            charge, a paycheck landing, something due today.
          </p>

          {state === "denied" && (
            <p className="mt-2 text-sm text-ink">
              Notifications are blocked. Turn them back on in Settings, then reload.
            </p>
          )}

          {error && <p className="mt-2 text-sm text-ink">{error}</p>}

          <button
            onClick={enable}
            disabled={state === "working"}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-2.5 text-[0.88rem] font-medium text-paper transition-colors hover:opacity-90 disabled:opacity-45 disabled:opacity-50"
          >
            {state === "working" ? "Turning on…" : "Turn on notifications"}
          </button>
        </>
      )}

    </div>
  );

}
