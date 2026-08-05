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


  if (state === "checking" || state === "unsupported") return null;


  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-6">

      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        Notifications
      </h2>

      {state === "needs-install" && (
        <p className="mt-3 text-sm text-muted">
          To get notifications on iPhone, this has to be installed as an app
          first: tap the Share button, then <span className="text-foreground">Add to Home Screen</span>,
          and open it from there. Safari tabs can&apos;t receive them.
        </p>
      )}

      {state === "subscribed" && (
        <p className="mt-3 text-sm text-foreground">
          On. You&apos;ll get one message a day at most, plus anything genuinely urgent.
        </p>
      )}

      {(state === "ready" || state === "working" || state === "denied") && (
        <>
          <p className="mt-3 text-sm text-muted">
            One message a day at most, plus anything urgent — a large unexpected
            charge, a paycheck landing, something due today.
          </p>

          {state === "denied" && (
            <p className="mt-2 text-sm text-foreground">
              Notifications are blocked. Turn them back on in Settings, then reload.
            </p>
          )}

          {error && <p className="mt-2 text-sm text-foreground">{error}</p>}

          <button
            onClick={enable}
            disabled={state === "working"}
            className="mt-3 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {state === "working" ? "Turning on…" : "Turn on notifications"}
          </button>
        </>
      )}

    </div>
  );

}
