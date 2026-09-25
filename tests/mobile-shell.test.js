import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const css = read("web/app/globals.css");
const layout = read("web/app/layout.js");
const pull = read("web/app/PullToRefresh.js");
const graph = read("web/app/graph/GraphCanvas.js");
const frame = read("web/app/AppFrame.js");
const ui = read("web/app/ui.js");

test("the mobile tab bar uses a small fixed inset from the viewport bottom", () => {
  assert.match(css, /--pos-tab-bottom:\s*0\.5rem/);
  assert.match(css, /\.pos-tab-frame\s*\{[\s\S]*?bottom:\s*var\(--pos-tab-bottom\)/);
  assert.doesNotMatch(
    css.match(/:root\s*\{[\s\S]*?--pos-tab-bottom:[^;]+;/)?.[0] || "",
    /safe-area-inset-bottom/,
    "a device-reported safe inset must not lift the whole bar again"
  );
});

test("graph controls share the tab bar's fixed baseline", () => {
  assert.doesNotMatch(graph, /bottom-\[calc\(env\(safe-area-inset-bottom\)/);
  assert.match(graph, /bottom-\[calc\(var\(--pos-tab-bottom\)\+6rem\)\]/);
  assert.match(graph, /bottom-\[calc\(var\(--pos-tab-bottom\)\+5\.5rem\)\]/);
});

test("signed-in routes share one permanent viewport and scroll surface", () => {
  assert.match(frame, /h-\[100dvh\]/);
  assert.match(frame, /id="pos-app-scroll"/);
  assert.match(frame, /overflow-y-auto/);
  assert.doesNotMatch(ui, /min-h-\[100svh\]/);
  assert.match(ui, /min-h-full/);
});

test("pull to refresh is global, visible, and requests fresh server data", () => {
  assert.match(layout, /<PullToRefresh \/>/);
  assert.match(pull, /touchstart/);
  assert.match(pull, /touchmove/);
  assert.match(pull, /Release to refresh/);
  assert.match(pull, /Refreshing/);
  assert.match(pull, /router\.refresh\(\)/);
  assert.match(pull, /pos-app-scroll/);
  assert.match(pull, /scroller\.scrollTop/);
  assert.doesNotMatch(pull, /window\.scrollY/);
});

test("pull to refresh avoids signed-out pages and the gesture-driven graph", () => {
  for (const route of ["/login", "/welcome", "/showcase", "/graph"]) {
    assert.ok(pull.includes(route), `${route} must not install the global pull gesture`);
  }
});
