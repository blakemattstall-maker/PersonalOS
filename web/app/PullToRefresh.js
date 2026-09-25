"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";


// A visible pull-to-refresh for the installed iPhone app.
//
// iOS will sometimes reload a standalone web app for this gesture, but it does
// not consistently paint Safari's refresh spinner. That made a successful pull
// look identical to an ignored one. This lightweight observer leaves scrolling
// and touch handling to the browser, shows progress while the page is stretched,
// and asks Next for fresh server data once the gesture crosses the threshold.
const TRIGGER = 76;
const MAX_TRAVEL = 66;

function PullToRefreshController({ pathname }) {
  const router = useRouter();
  const startY = useRef(null);
  const peak = useRef(0);
  const phaseRef = useRef("idle");
  const settleTimer = useRef(null);
  const [distance, setDistance] = useState(0);
  const [armed, setArmed] = useState(false);
  const [phase, setPhase] = useState("idle");

  const excluded = pathname === "/login"
    || pathname === "/welcome"
    || pathname === "/showcase"
    || pathname.startsWith("/graph");

  useEffect(() => {
    if (excluded) return undefined;

    const scroller = document.getElementById("pos-app-scroll");
    const atTop = () => !scroller || scroller.scrollTop <= 0;

    const reset = () => {
      startY.current = null;
      peak.current = 0;
      setArmed(false);
      setDistance(0);
    };

    const onStart = (event) => {
      if (phaseRef.current !== "idle" || !atTop() || event.touches.length !== 1) return;
      startY.current = event.touches[0].clientY;
      peak.current = 0;
    };

    const onMove = (event) => {
      if (startY.current == null || event.touches.length !== 1) return;
      if (!atTop()) return reset();

      const raw = Math.max(0, event.touches[0].clientY - startY.current);
      peak.current = Math.max(peak.current, raw);
      setArmed(raw >= TRIGGER);
      setDistance(Math.min(MAX_TRAVEL, raw * 0.58));
    };

    const onEnd = () => {
      if (startY.current == null) return;
      const shouldRefresh = peak.current >= TRIGGER;
      startY.current = null;
      peak.current = 0;
      setArmed(false);

      if (!shouldRefresh) {
        setDistance(0);
        return;
      }

      phaseRef.current = "refreshing";
      setPhase("refreshing");
      setDistance(48);
      startTransition(() => router.refresh());

      // router.refresh has no completion promise. Keep the acknowledgement on
      // screen long enough to be unmistakable, then show a positive completion
      // state; the route's own skeleton remains visible if the server is slower.
      settleTimer.current = window.setTimeout(() => {
        phaseRef.current = "done";
        setPhase("done");
        setDistance(42);
        settleTimer.current = window.setTimeout(() => {
          phaseRef.current = "idle";
          setPhase("idle");
          setDistance(0);
        }, 650);
      }, 800);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, [excluded, router]);

  if (excluded) return null;

  const visible = distance > 2 || phase !== "idle";
  const label = phase === "refreshing"
    ? "Refreshing"
    : phase === "done"
      ? "Updated"
      : armed ? "Release to refresh" : "Pull to refresh";

  return (
    <div
      className={`pos-pull-indicator ${visible ? "is-visible" : ""} ${phase === "refreshing" ? "is-refreshing" : ""}`}
      style={{ "--pos-pull-distance": `${distance}px` }}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      aria-label={visible ? label : undefined}
    >
      <span className="pos-pull-glyph" aria-hidden="true">{phase === "done" ? "✓" : "↓"}</span>
      <span>{label}</span>
    </div>
  );
}


export default function PullToRefresh() {
  const pathname = usePathname();
  // A path change remounts the gesture state. A navigation can otherwise
  // unmount its loading skeleton while a previous pull's timer is still live.
  return <PullToRefreshController key={pathname} pathname={pathname} />;
}
