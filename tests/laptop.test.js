import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The laptop bridge's entire safety story is checkable in source. The
// user's stated fear is precise — a window opening on his machine during an
// exam — so the properties that prevent it are pinned here: nothing enters
// the queue without the laptop being named, nothing stale ever executes,
// and the helper is physically incapable of doing anything but opening an
// http(s) URL.

const read = (p) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");

const TOOLS = read("web/lib/toolDefinitions.js");
const QUEUE = read("web/lib/laptopQueue.js");
const HELPER = read("laptop/almanac-laptop.py");
const CONVERSE = read("web/lib/deskConverse.js");


test("the tool forbids the router from volunteering the laptop", () => {
  const at = TOOLS.indexOf('"open_on_laptop"');
  assert.ok(at >= 0, "open_on_laptop must exist");
  const desc = TOOLS.slice(at, at + 900);
  assert.match(desc, /EXPLICITLY/);
  assert.match(desc, /NEVER volunteer/);
});

test("queued commands expire, on the server side", () => {
  assert.match(QUEUE, /COMMAND_TTL_MS = 60_000/);
  assert.match(QUEUE, /COMMAND_TTL_MS\)/);
});

test("only http(s) URLs can enter the queue", () => {
  assert.match(QUEUE, /\^https\?:\\\/\\\//);
});

test("the helper enforces TTL, pause, and http-only, and uses no shell", () => {
  assert.match(HELPER, /TTL_SECONDS = 60/);
  assert.match(HELPER, /PAUSE\.exists\(\)/);
  assert.match(HELPER, /startswith\(\("http:\/\/", "https:\/\/"\)\)/);
  assert.match(HELPER, /subprocess\.run\(\["open", url\]/);
  assert.ok(!HELPER.includes("shell=True"), "no shell execution, ever");
});

test("the desk's URL handoff is gated on the laptop being named", () => {
  const at = CONVERSE.indexOf("laptop handoff");
  assert.ok(at >= 0);
  assert.match(CONVERSE, /\\b\(laptop\|computer\|my mac\)\\b/);
});
