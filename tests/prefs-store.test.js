// app/prefs.js as an external store.
//
// SettingsPanel and DeepThoughtThread both read prefs through
// useSyncExternalStore, which calls getSnapshot on every render and compares the
// result with Object.is. A getSnapshot that builds a new object each call
// therefore never settles: React re-renders, gets a different object, and
// re-renders again, forever. It is a hang rather than an error message, and it
// only happens in a browser, so it is worth pinning down here.
//
// The trade the cache makes is the other failure mode — a snapshot that is
// stable but stale, so a saved preference never appears. Both directions are
// asserted below.

import test from "node:test";
import assert from "node:assert/strict";


// A window with just enough of one to satisfy prefs.js: event dispatch and a
// localStorage. Installed before the import, because readPrefs branches on
// `typeof window`.
function installWindow(initial = null) {

  const store = new Map();

  if (initial) store.set("pos_prefs", JSON.stringify(initial));

  const target = new EventTarget();

  globalThis.window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
  };

  // writePrefs calls applyTheme when `theme` is in the patch, which touches
  // document.documentElement.
  globalThis.document = { documentElement: { setAttribute() {}, removeAttribute() {} } };

  return store;

}


installWindow({ displayName: "Ada", rate: 1.35, engine: "device" });

const { prefsSnapshot, prefsServerSnapshot, subscribeToPrefs, writePrefs, DEFAULTS } =
  await import("../web/app/prefs.js");


test("the snapshot is the same reference until something changes it", () => {

  const first = prefsSnapshot();
  const second = prefsSnapshot();

  assert.equal(
    Object.is(first, second),
    true,
    "useSyncExternalStore compares snapshots with Object.is — a fresh object per call renders forever"
  );

  // And it is the stored value, not the defaults: a stable snapshot that never
  // reflects what was saved is the opposite failure.
  assert.equal(first.displayName, "Ada");
  assert.equal(first.rate, 1.35);

  // Keys absent from storage still come back, so no consumer has to guard for
  // them — this is what let SettingsPanel drop its `if (!prefs) return null`.
  assert.equal(first.autoplayBrief, DEFAULTS.autoplayBrief);

});


test("a write notifies subscribers and invalidates the snapshot", () => {

  const before = prefsSnapshot();

  let notified = 0;

  const unsubscribe = subscribeToPrefs(() => { notified += 1; });

  writePrefs({ displayName: "Grace" });

  assert.equal(notified, 1, "writePrefs must announce itself or nothing re-renders");

  const after = prefsSnapshot();

  assert.equal(Object.is(before, after), false, "a stale reference means the UI keeps the old value");
  assert.equal(after.displayName, "Grace");

  // Still stable once recomputed.
  assert.equal(Object.is(after, prefsSnapshot()), true);

  unsubscribe();

  writePrefs({ displayName: "Ada" });

  assert.equal(notified, 1, "unsubscribe has to actually detach the listener");

});


test("the server snapshot is a stable reference to the defaults", () => {

  // Used for both the server render and React's first client render, so it has
  // to be identical across calls for the same reason the client one does — and
  // it must be the defaults, since the server cannot read localStorage.
  assert.equal(Object.is(prefsServerSnapshot(), prefsServerSnapshot()), true);

  assert.deepEqual({ ...prefsServerSnapshot() }, { ...DEFAULTS });

});


test("a change made in another tab is picked up", () => {

  // localStorage writes from a different tab fire `storage` and nothing else, so
  // without that listener every other open tab renders the old preference until
  // it is reloaded.
  let notified = 0;

  const unsubscribe = subscribeToPrefs(() => { notified += 1; });

  window.dispatchEvent(new Event("storage"));

  assert.equal(notified, 1);

  unsubscribe();

});
