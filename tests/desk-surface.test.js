import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";


// The desk device shares the capture spine with the phone, and that spine is
// the most load-bearing code in this project. Everything the desk needed —
// composing a screen, skipping the phone notification, bounding the spoken
// answer, resolving "that role" against what is on the glass — was added as
// branches inside it.
//
// A branch is only safe if it is genuinely a branch. This reads the handler
// and checks that every desk behaviour sits behind the surface flag, because
// the failure being guarded against is silent: the phone would keep working
// in tests and quietly stop notifying, or start speaking in truncated
// sentences, and nobody would notice until it mattered.


const HANDLER = fs.readFileSync(
  path.join(import.meta.dirname, "..", "web/app/api/capture/handler.js"),
  "utf8"
);


test("the desk is identified by an explicit surface, not by guesswork", () => {
  assert.match(HANDLER, /const isDesk = req\.body\?\.surface === "desk"/);
});


test("the phone still gets its notification; only the desk skips it", () => {
  // The desk already said the answer out loud in the room. Everything else
  // must still buzz.
  // Every notifyCapture on a success path must be behind the desk check.
  const calls = [...HANDLER.matchAll(/await notifyCapture\(/g)];
  assert.ok(calls.length >= 3, "expected several notify paths");

  for (const call of calls) {
    const before = HANDLER.slice(Math.max(0, call.index - 260), call.index);
    // The error path at the very bottom is a deliberate exception: a capture
    // that threw is worth hearing about wherever it came from.
    if (/tool: "capture", error/.test(HANDLER.slice(call.index, call.index + 120))) continue;
    assert.match(before, /!isDesk/, "an unguarded notifyCapture would spam the phone from the desk");
  }
});


test("composing a screen is desk-only work", () => {
  // The composer lives in one helper now; what matters is that every call
  // site of that helper is behind the desk check, so a phone capture never
  // pays for a layout nobody will look at.
  const calls = [...HANDLER.matchAll(/await prepareDeskReply\(/g)];

  assert.ok(calls.length >= 2, "both return paths should prepare a desk reply");

  for (const call of calls) {
    const before = HANDLER.slice(Math.max(0, call.index - 300), call.index);
    assert.match(before, /isDesk/, "an unguarded compose would run for phone captures");
  }
});


test("the spoken answer is only shortened for the desk", () => {
  // Bounding happens inside prepareDeskReply, which only the desk calls, and
  // the phone's message goes out unshortened.
  assert.match(HANDLER, /function boundForSpeech/);
  assert.match(HANDLER, /message: deskSpoken \?\? spokenWithExtras/);
});


test("a single-tool phone capture returns the tool's own result, untouched", () => {
  // The desk needs the stitched/bounded message; the phone's existing
  // contract is that one tool returns exactly what that tool said.
  assert.match(HANDLER, /results\.length === 1 && !isDesk/);
});


test("deep thinking is still reachable, because its output belongs on the dashboard", () => {
  // It was briefly filtered out of the desk's tool list. That fixed the
  // symptom and removed the ability to start a real analysis by voice.
  assert.doesNotMatch(HANDLER, /TOOLS\.filter\(/);
  assert.match(HANDLER, /DEFERRED_TOOLS\.includes\(r\.tool\)/);
});


test("a deferred tool on the desk still answers out loud", () => {
  const at = HANDLER.indexOf("DEFERRED_TOOLS.includes(r.tool)");
  const after = HANDLER.slice(at, at + 700);
  assert.match(after, /answerQuestion/);
});


test("follow-up context is desk-only and never leaks into a phone capture", () => {
  assert.match(HANDLER, /let deskContext = null/);
  const at = HANDLER.indexOf("loadDeskContext");
  const before = HANDLER.slice(0, at);
  assert.match(before.slice(-300), /if \(isDesk\)/);
});
