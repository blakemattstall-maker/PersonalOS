import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const canvas = read("web/tools/canvas.js");
const diagnostics = read("web/lib/diagnostics.js");


// ---------------------------------------------------------------------------
// The fall syllabi landed as 42 assignments at once and 33 of them — every
// due date past early September — fell outside the sync's 21-day window.
// Nothing errored, nothing logged, and from the calendar's side the sync had
// simply "stopped working". These pin the two lessons: the window must hold a
// semester, and a run must leave a record that distinguishes "nothing new"
// from "everything failed".
// ---------------------------------------------------------------------------


test("the sync window holds a semester, not a fortnight", () => {

  const sync = canvas.slice(canvas.indexOf("export async function syncCanvasAssignments"));

  assert.match(
    sync,
    /getUpcomingCanvasAssignments\(\{ daysAhead: 180 \}\)/,
    "syncCanvasAssignments must ask for the semester-scale window explicitly"
  );

});


test("every sync run leaves a durable record, success or not", () => {

  assert.match(canvas, /action: "canvas_sync"/, "the run must log to activity_logs");

  // success must mean "nothing errored" — the Aug 15 dead-token run reported
  // success:true with 33 failures folded into a payload nobody stored.
  assert.match(canvas, /success: errors\.length === 0/);

  // And a logging failure must not take down the sync itself.
  assert.match(canvas, /\.catch\(error => console\.error\("CANVAS SYNC LOG FAILED/);

});


test("diagnostics surfaces the last sync run", () => {

  assert.match(diagnostics, /"canvas_sync"/, "diagnostics must read the sync's activity_logs record");
  assert.match(diagnostics, /syncCanvas: \{/, "the jobs section must carry a syncCanvas entry");

});


test("a Canvas URL parsed as {params, val} never reaches Google as an object", () => {

  // Canvas emits `URL;VALUE=URI:` on every assignment and node-ical keeps the
  // parameters, so event.url is an object — which 400'd every Google Tasks
  // insert for three weeks ("Starting an object on a scalar field") while the
  // sync swallowed each error. Only 2 of 42 assignments ever reached Google.
  assert.match(canvas, /typeof event\.url === "object"/);
  assert.match(canvas, /event\.url\.val/);

});


test("a mirror row without a google_task_id is repaired, not skipped", () => {

  // createTask writes its Supabase row before the Google insert, so a failed
  // insert leaves residue that satisfies a bare existence check — every later
  // run then reports "already up to date" about a task no calendar has shown.
  const sync = canvas.slice(canvas.indexOf("export async function syncCanvasAssignments"));

  assert.match(sync, /existing\?\.google_task_id/, "only a row that reached Google counts as synced");
  assert.match(sync, /deleteTaskRowById\(existing\.id\)/, "the half-create must be cleared and redone");

  const database = read("web/tools/database.js");
  assert.match(database, /select\("id, google_task_id"\)/, "findTaskByCanvasId must return the proof-of-sync column");

});
