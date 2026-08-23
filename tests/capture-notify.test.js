import test from "node:test";
import assert from "node:assert/strict";

import { describeCapture } from "../web/lib/captureNotify.js";
import { TOOLS } from "../web/lib/toolDefinitions.js";
import { URGENCY_TIERS } from "../web/lib/settings.js";


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

  // A count of ATTEMPTS read as a count of successes: this used to title
  // itself "2 things done (1 failed)", which says two things happened and one
  // didn't in the same breath. Exactly one thing happened.
  assert.equal(n.title, "1 of 2 done");
  assert.match(n.body, /boom/);

});


test("the title counts what worked, at every ratio", () => {

  const ok = (tool) => ({ tool, result: { success: true, message: `Did ${tool}` } });
  const bad = (tool) => ({ tool, error: "boom" });

  assert.equal(describeCapture([ok("a"), ok("b")]).title, "2 things done");
  assert.equal(describeCapture([ok("a"), ok("b"), bad("c")]).title, "2 of 3 done");

  // The hardcoded "(1 failed)" reported the same string here as it did for one
  // failure, so two things going wrong looked exactly like one.
  assert.equal(describeCapture([ok("a"), bad("b"), bad("c")]).title, "1 of 3 done");

  // All of them failing is a different notification entirely.
  assert.equal(describeCapture([bad("a"), bad("b")]).title, "Didn't work");

});


test("the failure names the action that failed", () => {

  // "That failed: taskResult is not defined" told the user an error happened
  // and not what it happened to — with a person save and an intention save in
  // the same capture, that is the only question worth answering.
  const n = describeCapture([
    { tool: "save_intention", result: { success: true, message: "Saved that." } },
    { tool: "save_person", error: "taskResult is not defined" }
  ]);

  assert.match(n.body, /Couldn't save person/);
  assert.match(n.body, /taskResult is not defined/);

});


test("the half that did not happen is read first", () => {

  // The body is truncated on the lock screen, so order decides what is seen.
  const n = describeCapture([
    { tool: "save_intention", result: { success: true, message: "Saved that." } },
    { tool: "save_person", error: "boom" }
  ]);

  assert.ok(
    n.body.indexOf("Couldn't save person") < n.body.indexOf("Saved that"),
    "the failure has to lead the body"
  );

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


// Reported from a real capture: tapping a created event opened Google's
// signed-out Calendar page instead of the event, because the installed PWA has
// no Google session. An in-app page always opens and always shows the change,
// so it wins wherever one exists.
test("anything the app can show links into the app, not to Google", () => {

  const event = describeCapture([{
    tool: "create_event",
    result: { success: true, message: "Created it.", data: { htmlLink: "https://www.google.com/calendar/event?eid=x" } }
  }]);

  assert.equal(event.url, "/", "a created event must open the app, not a Google page");

  const task = describeCapture([{
    tool: "create_task",
    result: { success: true, message: "Created it.", data: { htmlLink: "https://tasks.google.com/x" } }
  }]);

  assert.equal(task.url, "/");

});


// The two exceptions, and only these two: neither a Gmail draft nor an exported
// Doc has any in-app view, so the external URL is the only useful destination.
test("a draft and a doc still link out, because nothing in-app can show them", () => {

  const draft = describeCapture([{
    tool: "draft_email",
    result: { success: true, message: "Drafted it.", data: { url: "https://mail.google.com/x" } }
  }]);
  assert.equal(draft.url, "https://mail.google.com/x");

  const doc = describeCapture([{
    tool: "export_to_doc",
    result: { success: true, message: "Wrote it.", data: { url: "https://docs.google.com/document/d/y" } }
  }]);
  assert.equal(doc.url, "https://docs.google.com/document/d/y");

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
