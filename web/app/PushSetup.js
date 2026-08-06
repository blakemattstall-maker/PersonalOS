"use client";

import { useEffect, useState } from "react";
import { subscribeToPushAction, getVapidKeyAction } from "./actions.js";


// iOS refuses web push unless the app was installed via Share -> Add to Home
// Screen. From a normal Safari tab the permission prompt still appears, is
// still granted, and notifications then silently never arrive — so the state is
// detected and explained up front rather than letting that happen.

function urlBase64ToUint8Array(base64) {

  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);

  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));

}


export default function PushSetup() {

  const [state, setState] = useState("checking");
  const [error, setError] = useState(null);

  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);


  useEffect(() => {

    if (typeof window === "undefined") return;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    if (isIOS() && !isStandalone()) {
      setState("needs-install");
      return;
    }

    navigator.serviceWorker.register("/sw.js")
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setState(sub ? "subscribed" : "ready"))
      .catch(() => setState("ready"));

  }, []);


  const enable = async () => {

    setError(null);
    setState("working");

    try {

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState("denied");
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

      setState("subscribed");

    } catch (e) {
      setError(e.message);
      setState("ready");
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
