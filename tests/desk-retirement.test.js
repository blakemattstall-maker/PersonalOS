import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../web/lib/toolDefinitions.js";
import { designDeskScreen, stashDeskScreen, loadDeskScreen, loadDeskContext, clearDeskScreen } from "../web/lib/deskScreens.js";
import { pushLaptopCommand, setLaptopPaused } from "../web/lib/laptopQueue.js";

test("retired laptop actions are not offered to the model", () => {
  const names = TOOLS.map(tool => tool.function.name);
  assert.ok(!names.includes("open_on_laptop"));
  assert.ok(!names.includes("laptop_action"));
  assert.ok(names.includes("create_task"), "ordinary Almanac tools remain available");
});

test("retired screen and laptop operations do no network work", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected network request"); };
  try {
    assert.deepEqual(await designDeskScreen({ question: "hello", answer: "hello" }), { empty: true });
    await stashDeskScreen({ headline: "hello" });
    assert.equal(await loadDeskScreen(), null);
    assert.equal(await loadDeskContext(), null);
    await clearDeskScreen();
    await setLaptopPaused(false);
    assert.deepEqual(await pushLaptopCommand({ url: "https://example.com" }), { pushed: false, paused: true, retired: true });
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
