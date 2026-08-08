"use client";

import { animate, stagger, createTimeline, createDrawable, utils } from "animejs";

// The motion layer.
//
// Everything animated in this app goes through here rather than calling
// anime.js directly, for three reasons.
//
// 1. Reduced motion has to be enforced in JavaScript. globals.css already
//    neutralises every CSS animation and transition under
//    `prefers-reduced-motion`, but anime.js writes inline styles from a rAF
//    loop and that rule cannot touch it. Without the gate here, the one group
//    of people who explicitly asked the OS for less movement would be the only
//    group getting more of it.
//
// 2. Reduced motion must not mean "invisible". Every helper below has a
//    settled state, and when motion is off that state is applied immediately
//    instead of being animated toward. Skipping the animation and leaving the
//    element at opacity 0 is the classic version of this bug.
//
// 3. Animation costs battery on the phone this actually runs on. Scene
//    timelines are driven by an IntersectionObserver and paused the moment
//    they leave the viewport, so a long scrolling page is never running eight
//    timelines at once.

export { animate, stagger, createTimeline, createDrawable, utils };


export function reducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}


// The settled state for anything using the `.pos-reveal` class. Written as one
// function so "revealed" is defined in exactly one place — the reduced-motion
// path, the observer path and the failsafe below all call this.
export function settle(elements) {
  utils.set(elements, { opacity: 1, translateY: 0 });
}


/**
 * Staggered entrance for the direct children marked `data-reveal` inside
 * `root`. Elements start hidden via the `.pos-reveal` class in globals.css,
 * which is also what the `<noscript>` override and the reduced-motion media
 * query target — so content is visible without JavaScript, visible without
 * motion, and animated only when both are available.
 *
 * Returns a cleanup function.
 */
export function revealChildren(root, { delay = 0, gap = 60, distance = 14 } = {}) {

  if (!root) return () => {};

  const targets = Array.from(root.querySelectorAll("[data-reveal]"));

  if (targets.length === 0) return () => {};

  if (reducedMotion()) {
    settle(targets);
    return () => {};
  }

  // The only way these elements never get un-hidden is if the observer does
  // not exist at all. A supported IntersectionObserver always delivers an
  // initial observation for every target it is given, intersecting or not, so
  // once we are past this line every target is guaranteed to be visited.
  //
  // This started life as a 2.5-second timer that settled everything
  // unconditionally, which was worse than useless: on a page taller than the
  // viewport it revealed every card below the fold before the reader had
  // scrolled to any of them, quietly turning a scroll reveal into a delay.
  if (typeof IntersectionObserver === "undefined") {
    settle(targets);
    return () => {};
  }

  utils.set(targets, { opacity: 0, translateY: distance });

  const seen = new WeakSet();

  const observer = new IntersectionObserver((entries) => {

    const arrived = entries
      .filter(e => e.isIntersecting && !seen.has(e.target))
      .map(e => { seen.add(e.target); observer.unobserve(e.target); return e.target; });

    if (arrived.length === 0) return;

    animate(arrived, {
      opacity: 1,
      translateY: 0,
      duration: 620,
      delay: stagger(gap, { start: delay }),
      ease: "out(3)"
    });

  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

  targets.forEach(t => observer.observe(t));

  return () => observer.disconnect();

}


/**
 * Counts an element's text from 0 to `value` once it is on screen.
 *
 * `format` receives a number and returns the string actually written, so the
 * caller keeps ownership of currency, separators and precision. Nothing here
 * does arithmetic on the value beyond interpolating toward it — the figures in
 * this app are computed server-side and this must not become a second opinion
 * about what they are.
 */
export function countUp(el, value, { format = (n) => String(Math.round(n)), duration = 1100 } = {}) {

  if (!el) return () => {};

  const target = Number(value) || 0;

  const write = (n) => { el.textContent = format(n); };

  if (reducedMotion()) {
    write(target);
    return () => {};
  }

  let animation = null;
  let done = false;

  const finish = () => { if (!done) { done = true; write(target); } };

  // Same reasoning as revealChildren: the figure is already on screen from the
  // server render, so the only case that needs handling is no observer at all.
  // A timer here would count a figure up before it was ever scrolled to.
  if (typeof IntersectionObserver === "undefined") {
    write(target);
    return () => {};
  }

  const observer = new IntersectionObserver((entries) => {

    if (!entries.some(e => e.isIntersecting)) return;

    observer.disconnect();

    const state = { n: 0 };

    animation = animate(state, {
      n: target,
      duration,
      ease: "out(4)",
      onUpdate: () => write(state.n),
      onComplete: finish
    });

  }, { threshold: 0.2 });

  observer.observe(el);

  return () => {
    observer.disconnect();
    animation?.pause();
    finish();
  };

}


/**
 * Runs `build(root)` — which returns an anime.js timeline — the first time
 * `root` scrolls into view, then plays it while visible and pauses it while
 * not. This is what keeps a ten-section scrolling page from running every
 * animation it has ever started.
 *
 * `build` may also return null, which means "nothing to animate here".
 */
export function sceneTimeline(root, build, { settleOnReduced } = {}) {

  if (!root) return () => {};

  if (reducedMotion()) {
    settleOnReduced?.(root);
    return () => {};
  }

  let timeline = null;

  const observer = new IntersectionObserver((entries) => {

    const visible = entries.some(e => e.isIntersecting);

    if (visible && !timeline) {
      timeline = build(root);
      return;
    }

    if (!timeline) return;

    if (visible) timeline.play();
    else timeline.pause();

  }, { threshold: 0.15 });

  observer.observe(root);

  return () => {
    observer.disconnect();
    timeline?.pause();
    timeline?.revert?.();
  };

}
