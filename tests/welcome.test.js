import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";


// The signed-out tour, and the motion layer it shares with the rest of the app.
//
// Everything here is a property that fails silently if it breaks. A redirect
// loop looks like a hung browser, a missing reduced-motion override looks like
// a blank page, and an accidental data import on the one unauthenticated route
// looks like nothing at all until someone reads the network tab.


const ROOT = path.resolve(import.meta.dirname, "..");
const WELCOME = path.join(ROOT, "web/app/welcome");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");


function proxyMatcher() {
  const source = read("web/proxy.js");
  const match = source.match(/matcher:\s*\[\s*"([^"]+)"/);
  assert.ok(match, "could not find the matcher in web/proxy.js");
  // Anchored, because that is how Next.js compiles a matcher — as a full-path
  // pattern, not a search.
  return new RegExp(`^${match[1]}$`);
}


// --- the redirect loop this change could most easily have shipped ---------

// The gate sends anyone without the session cookie to /welcome. If /welcome is
// itself behind the gate, that visitor is redirected to /welcome, which
// redirects to /welcome. The symptom is not an error page — it is a browser
// that spins and then reports too many redirects, on the one URL this app
// exists to be shared as.
test("the page the gate redirects to is not itself behind the gate", () => {

  const source = read("web/proxy.js");

  const redirect = source.match(/NextResponse\.redirect\(new URL\("([^"]+)"/);

  assert.ok(redirect, "could not find the redirect target in web/proxy.js");

  const target = redirect[1];

  assert.equal(
    proxyMatcher().test(target),
    false,
    `${target} is both the redirect target and behind the gate — that is an infinite redirect`
  );

});


test("the redirect target is a route that actually exists", () => {

  const source = read("web/proxy.js");

  const target = source.match(/NextResponse\.redirect\(new URL\("([^"]+)"/)[1];

  assert.ok(
    fs.existsSync(path.join(ROOT, "web/app", target, "page.js")),
    `${target} has no page.js — the gate would redirect to a 404`
  );

});


test("the passphrase gate still covers every real page", () => {

  const pattern = proxyMatcher();

  for (const url of ["/", "/money", "/people", "/settings", "/news", "/practice"]) {
    assert.equal(pattern.test(url), true, `${url} is no longer behind the passphrase`);
  }

});


// --- the only route a stranger can reach ---------------------------------

// /welcome is outside the session check, so it must not be able to touch the
// database, the bank connection or Google — not even by importing a module
// that constructs a client as a side effect. It renders illustrative figures
// written into its own source, and it must stay that way.
test("nothing in the welcome tour reaches live data", () => {

  const forbidden = /(backend\.js|supabase|googleapis|lib\/google|lib\/openai|\/tools\/)/;

  const files = fs.readdirSync(WELCOME).filter(f => f.endsWith(".js"));

  assert.ok(files.length >= 6, "expected the welcome tour to still be several files");

  for (const file of files) {

    const source = fs.readFileSync(path.join(WELCOME, file), "utf8");

    for (const line of source.split("\n")) {

      if (!/^\s*import\b/.test(line)) continue;

      assert.equal(
        forbidden.test(line),
        false,
        `web/app/welcome/${file} imports live data: ${line.trim()}`
      );

    }

  }

});


test("the welcome page is not opted out of static rendering", () => {

  const source = read("web/app/welcome/page.js");

  assert.equal(
    /export const dynamic\s*=\s*["']force-dynamic["']/.test(source),
    false,
    "the tour has no data to read and must stay prerendered — it is the first thing a stranger loads"
  );

});


// --- the blank-page failure mode -----------------------------------------

// Entrance animations start at opacity 0 and are undone by JavaScript. Every
// path where that JavaScript does not run needs its own override, or the page
// renders as an empty screen with no error anywhere.
test("content hidden for animation is restored without motion and without scripting", () => {

  const css = read("web/app/globals.css");

  assert.ok(css.includes(".pos-reveal"), "the reveal start state has gone missing");

  const reducedBlocks = css.split("@media (prefers-reduced-motion: reduce)").slice(1);

  assert.ok(
    reducedBlocks.some(block => block.slice(0, 200).includes(".pos-reveal")),
    "no reduced-motion override for .pos-reveal — the one group that asked for less motion would get a blank page"
  );

  const layout = read("web/app/layout.js");

  assert.ok(
    /<noscript>[\s\S]*pos-reveal[\s\S]*<\/noscript>/.test(layout),
    "no <noscript> override for .pos-reveal — the page renders blank with scripting off"
  );

});


// intersectionRatio is measured against the ELEMENT, not the viewport, so an
// element taller than `viewport / threshold` can never reach a fractional
// threshold however far it is scrolled — it just never reveals, and its card
// stays blank forever. That shipped: /practice wrapped its entire topic list
// in one reveal target at threshold 0.15 and rendered as a tall empty gap.
//
// threshold 0 plus a bottom rootMargin inset is correct for an element of any
// height and is the only combination allowed in this codebase.
test("no scroll observer uses a fractional threshold", () => {

  const files = [
    "web/app/motion.js",
    "web/app/MoneyCharts.js",
    "web/app/welcome/SceneGraph.js"
  ];

  for (const file of files) {

    const source = read(file);

    const fractional = source.match(/threshold:\s*0?\.\d+/g) || [];

    assert.deepEqual(
      fractional,
      [],
      `${file} uses a fractional IntersectionObserver threshold (${fractional.join(", ")}). ` +
      "Use threshold: 0 with a rootMargin inset — a tall element can never reach a fractional ratio."
    );

  }

});


// The splash is rendered by React inside the root layout, so React owns that
// node. Removing it from outside React means the next reconciliation of the
// layout — which every router.refresh() triggers, and so nearly every server
// action — operates on a node that is no longer there and throws. With no
// error.js in this app that surfaced as Next's built-in "This page couldn't
// load" on navigation and on most buttons.
test("the boot splash is hidden by class, never removed from the DOM", () => {

  const layout = read("web/app/layout.js");

  const script = layout.slice(layout.indexOf("const BOOT_SCRIPT"), layout.indexOf("export default"));

  assert.ok(
    script.includes("classList.add"),
    "the boot splash should be dismissed by adding a class"
  );

  assert.equal(
    /\.remove\(\)|removeChild/.test(script),
    false,
    "the boot splash must never be removed from the DOM — React rendered it and still owns it"
  );

  // Hidden has to mean inert, since the element now stays in the tree for the
  // life of the page rather than being deleted.
  const css = read("web/app/globals.css");

  const rule = css.slice(css.indexOf("#pos-boot.pos-boot-hide"));

  assert.ok(rule.includes("pointer-events: none"), "a permanent overlay must not swallow clicks");
  assert.ok(rule.includes("visibility: hidden"), "a permanent overlay must leave the accessibility tree");

});


test("the motion layer refuses to animate when the OS asks it not to", () => {

  const source = read("web/app/motion.js");

  assert.ok(
    source.includes("prefers-reduced-motion"),
    "motion.js must check the media query itself — the CSS rule in globals.css cannot reach inline styles written by anime.js"
  );

  // Every helper has to consult it. A helper that skips the check does not
  // merely animate anyway; it can leave its target at the opacity 0 it set.
  for (const helper of ["revealChildren", "countUp", "sceneTimeline"]) {

    const body = source.slice(source.indexOf(`function ${helper}`));

    assert.ok(
      body.slice(0, 1400).includes("reducedMotion()"),
      `${helper} does not check reducedMotion()`
    );

  }

});


// --- the figures on screen -----------------------------------------------

// countUp interpolates toward a number the server computed. It must write that
// exact number at the end rather than the last interpolated frame, or a
// dollar figure can settle one cent short of what the page says it is.
test("a counted number always lands on the value it was given", () => {

  const source = read("web/app/motion.js");

  const body = source.slice(source.indexOf("export function countUp"));

  assert.ok(
    /const finish = \(\) => \{[^}]*write\(target\)/.test(body),
    "countUp must write the exact target on completion, not the final animated frame"
  );

  assert.ok(
    body.includes("onComplete: finish"),
    "countUp does not settle on the real value when the animation ends"
  );

});


// A counted figure is formatted twice: once on the server, for the text that
// renders before hydration, and once on the client, by <Counted />. The two
// must agree exactly, or every money tile visibly rewrites itself on load —
// $999.99 becoming $1,000, or a decimal appearing where there wasn't one.
//
// They cannot share a function: money() lives in a server component, and
// <Counted /> needs a formatter on the client, which is why the shape is
// described with serialisable props instead of passed as a callback. Since the
// rule is written down twice, this checks the two copies still say the same
// thing.
test("the server and client renderings of a money figure agree", () => {

  const money = (n, { sign = false } = {}) => {
    const v = Math.abs(Number(n) || 0);
    const s = v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(2);
    return `${sign && Number(n) < 0 ? "−" : sign ? "+" : ""}$${s}`;
  };

  const moneyParts = (n, { sign = false } = {}) => {
    const v = Math.abs(Number(n) || 0);
    return { value: v, decimals: v >= 1000 ? 0 : 2, prefix: `${sign && Number(n) < 0 ? "−" : sign ? "+" : ""}$` };
  };

  const counted = (p) => p.prefix + Math.abs(p.value).toLocaleString("en-US", {
    minimumFractionDigits: p.decimals,
    maximumFractionDigits: p.decimals
  });

  // The boundaries are the interesting part: either side of 1000, zero, and
  // both signs.
  const cases = [
    [0, {}], [5, {}], [84, {}], [412.86, {}], [999.99, {}],
    [1000, {}], [5500, {}], [12345.67, {}],
    [-320.5, { sign: true }], [320.5, { sign: true }],
    [-1500, { sign: true }], [0, { sign: true }]
  ];

  for (const [n, opts] of cases) {
    assert.equal(counted(moneyParts(n, opts)), money(n, opts), `formatting drifted at ${n}`);
  }

  // …and the copies this test mirrors are still the ones actually shipping.
  const view = read("web/app/MoneyView.js");

  assert.ok(view.includes("function moneyParts"), "moneyParts has been renamed or removed");
  assert.equal(
    (view.match(/v >= 1000/g) || []).length,
    2,
    "money() and moneyParts() no longer share the same 1000 threshold"
  );
  assert.equal(
    /<Stat[^>]*\svalue=/.test(view),
    false,
    "a Stat is still being given a pre-formatted string — it takes `amount` so the figure can be counted"
  );

});


// Switching range must not put a figure on screen that no longer matches the
// range being shown. <Counted /> writes its text through a ref rather than as
// rendered children, so React has no reason to update it on a re-render — the
// previous range's number simply stays there unless the element is remounted.
test("a counted figure is keyed so a range switch re-runs it", () => {

  const view = read("web/app/MoneyView.js");

  const counted = view.slice(view.indexOf("<Counted"), view.indexOf("</Counted>"));

  assert.ok(
    /key=\{/.test(counted),
    "<Counted /> needs a key tied to its value, or a range switch leaves the old figure on screen"
  );

});
