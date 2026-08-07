import test from "node:test";
import assert from "node:assert/strict";

import { describeCapture } from "../lib/captureNotify.js";
import { TOOLS } from "../lib/toolDefinitions.js";
import { URGENCY_TIERS } from "../lib/settings.js";


// The capture Shortcut is silent now, so this notification is the only reply a
// capture ever gets — including when the capture was a question, and including
// when it failed. A bug here is not a cosmetic one: it is a capture that
// appears to vanish.


test("every tool the model can call produces a notification", () => {

  const silent = [];

  for (const entry of TOOLS) {

    const tool = entry.function.name;

    const notification = describeCapture([
      { tool, result: { success: true, message: `did the ${tool} thing` } }
    ]);

    if (!notification || !notification.title || !notification.body) {
      silent.push(tool);
    }

  }

  assert.deepEqual(silent, [], `These tools would capture silently: ${silent.join(", ")}`);

});


test("a failure is never reported as a success", () => {

  const n = describeCapture([{ tool: "create_task", error: "Google Tasks timed out" }]);

  assert.equal(n.title, "Didn't work");
  assert.match(n.body, /timed out/);

});


test("a partial failure says so rather than reporting only the win", () => {

  const n = describeCapture([
    { tool: "create_event", result: { success: true, message: "Created event" } },
    { tool: "create_task", error: "boom" }
  ]);

  assert.match(n.title, /failed/);
  assert.match(n.body, /boom/);

});


// A tool reporting success:false is a different shape from a thrown error, and
// the old spoken-message stitching treated them identically. This is the case
// where the app knows it did nothing and must not claim otherwise.
test("success:false counts as a failure, not just a thrown error", () => {

  const n = describeCapture([
    { tool: "modify_task", result: { success: false, message: "Couldn't find that task." } }
  ]);

  assert.equal(n.title, "Didn't work");

});


test("it links to the real artefact when there is one", () => {

  const draft = describeCapture([{
    tool: "draft_email",
    result: { success: true, message: "Drafted it.", data: { url: "https://mail.google.com/x" } }
  }]);
  assert.equal(draft.url, "https://mail.google.com/x");

  const event = describeCapture([{
    tool: "create_event",
    result: { success: true, message: "Created it.", data: { htmlLink: "https://calendar.google.com/y" } }
  }]);
  assert.equal(event.url, "https://calendar.google.com/y");

});


test("it falls back to a dashboard page, never to nothing", () => {

  const n = describeCapture([{ tool: "save_note", result: { success: true, message: "Noted." } }]);

  assert.equal(n.url, "/data");

});


// Captures stack; the daily digest replaces. Sharing a tag would hide two of
// three things he did in a row.
test("each capture gets its own tag so they do not replace each other", () => {

  const a = describeCapture([{ tool: "save_note", result: { success: true, message: "one" } }]);
  const b = describeCapture([{ tool: "save_note", result: { success: true, message: "two" } }]);

  assert.match(a.tag, /^capture-/);
  assert.notEqual(a.tag, "personalos");
  assert.ok(a.tag && b.tag);

});


test("a long answer is truncated rather than sent whole", () => {

  const n = describeCapture([{ tool: "query_schedule", result: { success: true, message: "x".repeat(900) } }]);

  assert.ok(n.body.length < 400, `body was ${n.body.length} characters`);
  assert.match(n.body, /…$/);

});


test("nothing to report yields no notification at all", () => {

  assert.equal(describeCapture([]), null);
  assert.equal(describeCapture(null), null);

});


// The whole feature is unreachable if the urgency it uses isn't classified —
// this is the exact bug tests/notifications.test.js was written for, applied to
// the one push that must arrive on every single capture.
test("capture_confirmation is a declared urgency, at the lowest pushing tier", () => {

  assert.ok("capture_confirmation" in URGENCY_TIERS);
  assert.equal(URGENCY_TIERS.capture_confirmation, "digest");

});
