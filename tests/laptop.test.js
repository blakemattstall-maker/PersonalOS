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

test("verbs are a closed dictionary the server can only name, never write", () => {
  assert.match(HELPER, /argv = VERBS\.get\(verb\)/);
  const ROUTER = read("web/lib/router.js");
  assert.match(ROUTER, /VERBS = new Set\(/);
  assert.match(QUEUE, /\^\[a-z_\]\{3,30\}\$/);
});

test("shortcuts only run what exists, and the allowlist narrows it", () => {
  assert.match(HELPER, /\["shortcuts", "list"\]/);
  assert.match(HELPER, /shortcuts_allowlist/);
  assert.match(HELPER, /\["shortcuts", "run", best\]/);
});

test("the messages kind can open a thread and nothing else", () => {
  assert.match(HELPER, /open", f"sms:\{phone\}/);
  // Contacts are resolved ON the laptop — only the spoken name travels.
  assert.match(HELPER, /application "Contacts"/);
  // The only route into Messages is the sms: URL, which opens a thread.
  // Scripting Messages is the send pathway, and it must not exist here.
  assert.ok(!HELPER.includes('application "Messages"'), "no Messages scripting in the helper");
});

test("chains can never reach the laptop or nest", () => {
  const CHAINS = read("web/lib/chains.js");
  // The allowlist IS the boundary — only what it names is callable.
  const allow = CHAINS.slice(CHAINS.indexOf("CHAIN_TOOLS = new Set"), CHAINS.indexOf("MAX_STEPS"));
  assert.ok(allow.length > 100, "allowlist block found");
  assert.ok(!allow.includes("open_on_laptop"), "no laptop tools inside a chain");
  assert.ok(!allow.includes("laptop_action"), "no laptop verbs inside a chain");
  assert.ok(!allow.includes("start_deep_thinking"), "no nesting deep thought");
  assert.ok(!allow.includes("run_chain"), "a chain cannot start a chain");
  assert.match(CHAINS, /CHAIN_TOOLS\.has\(toolName\)/);
  assert.match(CHAINS, /MAX_STEPS = 6/);
  // End-of-chain laptop delivery exists but ONLY when the spoken request
  // named the laptop — the same gate as everywhere else.
  const delivery = CHAINS.indexOf("pushLaptopCommand");
  const gate = CHAINS.indexOf("(laptop|computer|mac)");
  assert.ok(delivery > 0 && gate > 0 && gate < delivery, "laptop delivery must sit behind the naming gate");
});

test("the desk speaks the laptop's own verdict, not optimism", () => {
  const ROUTER = read("web/lib/router.js");
  assert.match(ROUTER, /awaitLaptopResult\(id\)/);
  assert.match(ROUTER, /Your laptop says:/);
  assert.match(HELPER, /"action": "report"/);
});

test("the pause flag lives where the drain cannot touch it", () => {
  // Two shipped regressions, one root: the pause shared a record with the
  // queue, and the helper's 2-second read-modify-write poll first erased a
  // fresh pause, then resurrected a lifted one. Its own key ends the race.
  assert.match(QUEUE, /PAUSE_KEY = "laptop_paused"/);
  assert.match(QUEUE, /if \(paused\) return \{ pushed: false, paused: true \}/);
  const drain = QUEUE.slice(QUEUE.indexOf("drainLaptopCommands"));
  assert.ok(!drain.includes("PAUSE_KEY"), "drain must never write the pause record");
});

test("the desk's URL handoff is gated on the laptop being named", () => {
  const at = CONVERSE.indexOf("laptop handoff");
  assert.ok(at >= 0);
  assert.match(CONVERSE, /\\b\(laptop\|computer\|my mac\)\\b/);
});
