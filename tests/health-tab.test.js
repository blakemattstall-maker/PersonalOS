import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { ENTITIES } from "../web/lib/links.js";
import { nodeLabel, detail } from "../web/app/graph/phrasing.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");


// ---------------------------------------------------------------------------
// The Health tab, the menu that can be searched, per-item food logging, and
// the graph as a record of everything — not just the connected parts.
// ---------------------------------------------------------------------------


test("the nav reads Today, Health, Money, People, News, Settings", () => {

  const source = read("web/app/TabBar.js");

  const order = [...source.matchAll(/label: "([^"]+)"/g)].map(m => m[1]);

  assert.deepEqual(order, ["Today", "Health", "Money", "People", "News", "Settings"]);

  // /food must keep working — a home-screen shortcut or an old push payload
  // still points at it.
  assert.match(read("web/app/food/page.js"), /redirect\(`\/health/);
  assert.match(source, /also: \["\/food"\]/, "the Health tab must stay lit on the legacy route");

});


test("food is logged one row per item, except a plan that owns an event", () => {

  const source = read("web/tools/mealPlan.js");

  assert.match(source, /const perItem = status !== "planned"/);
  assert.match(source, /items: \[item\]/, "each eaten food becomes its own row");

  // The reply's totals must sum the rows just written, not read one of them.
  assert.match(source, /sumField\(logged\.rows \|\| \[logged\.row\], "calories"\)/);

});


test("the menu can be searched and collapsed without a model", () => {

  const source = read("web/app/DiningMenu.js");

  assert.match(source, /type="search"/);
  assert.match(source, /toLowerCase\(\)\.includes\(q\)/, "plain substring matching — finding 'chicken' is a string problem");
  assert.doesNotMatch(source, /openai|MODELS\./, "search must not call a model");

  // Collapsed by default; a search result opens its station without a tap.
  assert.match(source, /forceOpen \|\| open/);
  assert.match(source, /forceOpen=\{Boolean\(q\)\}/);

});


test("every datapoint stream is a graph entity, and isolated ones still draw", () => {

  for (const type of ["weigh_in", "meal", "brief", "insight", "prompt", "practice"]) {
    assert.ok(ENTITIES[type], `${type} must be registered so the graph can show it`);
  }

  const links = read("web/lib/links.js");

  assert.match(links, /async function isolatedNodes/, "a datapoint nobody linked must still reach the canvas");
  assert.match(links, /val: 0/, "isolated nodes are marked so the canvas can size them apart");

  // A graph with no edges is still a graph of everything that happened.
  assert.match(links, /const edges = \(error \? \[\] : data\) \|\| \[\]/);

  const canvas = read("web/app/graph/GraphCanvas.js");
  assert.match(canvas, /if \(!node\.val\) return 2\.2/);
  assert.match(canvas, /weigh_in: "notes"/);

});


test("datapoint nodes say what they are, not just their column value", () => {

  assert.equal(nodeLabel({ type: "weigh_in", label: 216.2 }), "216.2 lbs");
  assert.equal(nodeLabel({ type: "meal", label: "Lunch", extra: 640 }), "Lunch · 640 cal");
  assert.equal(nodeLabel({ type: "brief", label: "Long prose…" }), "Morning brief");
  assert.equal(nodeLabel({ type: "person", label: "Joey" }), "Joey", "named types are unchanged");

  assert.equal(detail({ type: "meal", extra: 640 }), "640 cal");

});


test("a long capture answer is filed, not only pushed", () => {

  const source = read("web/lib/captureNotify.js");

  // Notifications truncate and vanish; the answer has to survive the swipe.
  assert.match(source, /ANSWER_TOOLS/);
  assert.match(source, /query_health/);
  assert.match(source, /kind: "general_question"/);

  // Filed regardless of interruption level — turning pushes down must not
  // throw the answer away.
  const notify = source.slice(source.indexOf("export async function notifyCapture"));
  const filed = notify.indexOf("fileAnswer");
  const gate = notify.indexOf("pushAllowed");
  assert.ok(filed > 0 && filed < gate, "the answer must be filed before the push gate");

  // And the Google outage alert leaves a record too.
  assert.match(read("web/lib/google.js"), /from\("prompts"\)\.insert/);

});


test("weigh-ins can be logged from the app, and a fat-finger is refused", () => {

  const handler = read("web/app/api/[resource]/handler.js");

  assert.match(handler, /async function health\(req, res\)/);
  assert.match(handler, /value < 50 \|\| value > 1000/, "one 2160 would reshape the pace, the brief and every nudge");
  assert.match(handler, /RESOURCES = \{[^}]*health/);

  assert.match(read("web/app/actions.js"), /logWeightAction/);
  assert.match(read("web/app/BodyCard.js"), /logWeightAction/);

});
