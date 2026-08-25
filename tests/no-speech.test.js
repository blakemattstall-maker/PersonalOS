import test from "node:test";
import assert from "node:assert/strict";

import { looksHallucinated } from "../web/tools/pitch.js";


// A transcriber handed silence does not return nothing. It returns something
// — a stock phrase out of its training data, or a fluent sentence in a
// language nobody in the room was speaking. On a desk device that listens for
// a wake word, that is not a curiosity: the invented sentence gets routed as
// an instruction, and the thing asks its owner to clarify something he never
// said. It also sent a confident Mandarin notification to his phone.
//
// This is the gate that stops an invention becoming a command.


test("silence's favourite inventions are refused", () => {
  for (const text of [
    "Thank you.",
    "Thanks for watching!",
    "Please subscribe",
    "you",
    "Bye.",
    "   ",
    "Subtitles by the Amara.org community",
    "..."
  ]) {
    assert.equal(looksHallucinated(text), true, `should have refused: ${text}`);
  }
});


test("the language was pinned to English, so other scripts are inventions", () => {
  // The two that actually reached the device, plus their neighbours.
  assert.equal(looksHallucinated("请订阅我的频道"), true);      // Chinese
  assert.equal(looksHallucinated("こんにちは"), true);          // Japanese
  assert.equal(looksHallucinated("Спасибо за просмотр"), true); // Russian
  assert.equal(looksHallucinated("안녕하세요"), true);           // Korean
});


test("a real instruction survives the gate", () => {
  for (const text of [
    "What's on my calendar today?",
    "Is my cut working and can I afford it",
    "Remind me to call my mom tomorrow",
    "add eggs to the grocery list"
  ]) {
    assert.equal(looksHallucinated(text), false, `should have allowed: ${text}`);
  }
});


// German came back too, and German is Latin script — the script check cannot
// catch it. This documents the honest limit of that heuristic: the defence
// against it is the device refusing to upload silence in the first place,
// not this function.
test("the script check is not claimed to catch Latin-script inventions", () => {
  assert.equal(looksHallucinated("Vielen Dank für das Zuschauen"), false);
});


test("noise that is not a sentence is refused", () => {
  assert.equal(looksHallucinated("mm"), true);   // too short
  assert.equal(looksHallucinated("zzz"), true);  // no vowel at all
  // "hmm" has no vowel either, and refusing it is right: it is a noise a
  // room makes, not an instruction anyone gave this device.
  assert.equal(looksHallucinated("hmm"), true);
  assert.equal(looksHallucinated("hey"), false); // vowel, long enough, real
});
