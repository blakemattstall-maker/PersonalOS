import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { Downsampler24to16, downsampleBatch24to16 } from "../web/lib/pcmStream.js";


// The desk's streaming exchange: one POST of raw audio up, a stream of typed
// frames back down — meta, audio as it is synthesized, the composed screen,
// an end marker. Two kinds of failure are guarded here.
//
// The first is signal damage at chunk seams: a streaming resampler that is
// not byte-identical to the batch one is audibly wrong at every network
// boundary, which is precisely the class of bug ("audio quality
// significantly got worse") that has already happened once in this project.
//
// The second is drift between the streaming path and the JSON path. They
// must route the same words through the same router prompt and match the
// same spoken commands, or "never mind" starts meaning different things
// depending on which firmware build is installed.


const read = (p) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");

const CONVERSE = read("web/lib/deskConverse.js");
const ROUTE = read("web/app/api/capture/route.js");
const ANSWER = read("web/tools/answer.js");
const SCREEN = read("web/app/api/[resource]/deskScreen.js");


// ---------------------------------------------------------------------------
// The resampler: stream must equal batch, whatever the chunking.
// ---------------------------------------------------------------------------

function syntheticPcm(samples) {

  const buf = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i++) {
    // A few kHz of content plus something above the 7kHz cutoff, so the
    // filter actually has work to do.
    const v = Math.round(
      9000 * Math.sin((2 * Math.PI * 440 * i) / 24000) +
      5000 * Math.sin((2 * Math.PI * 3100 * i) / 24000) +
      3000 * Math.sin((2 * Math.PI * 9800 * i) / 24000)
    );
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }

  return buf;

}


function runStreamed(pcm, chunkSizes) {

  const ds = new Downsampler24to16();

  const out = [];

  let at = 0;
  let i = 0;

  while (at < pcm.length) {
    const size = chunkSizes[i++ % chunkSizes.length];
    out.push(ds.push(pcm.subarray(at, Math.min(at + size, pcm.length))));
    at += size;
  }

  out.push(ds.flush());

  return Buffer.concat(out);

}


test("streamed resampling is byte-identical to batch, on even chunks", () => {

  const pcm = syntheticPcm(24000);   // one second

  assert.deepEqual(runStreamed(pcm, [4096]), downsampleBatch24to16(pcm));

});


test("streamed resampling survives chunks that split samples mid-byte", () => {

  const pcm = syntheticPcm(9601);    // odd sample count for good measure

  // Odd sizes guarantee 16-bit samples straddle chunk boundaries constantly.
  assert.deepEqual(runStreamed(pcm, [1, 3, 7, 501, 13, 4097]), downsampleBatch24to16(pcm));

});


test("output length matches the batch contract exactly", () => {

  const pcm = syntheticPcm(24000);

  const out = runStreamed(pcm, [777]);

  assert.equal(out.length / 2, Math.floor(24000 * 2 / 3));

});


// ---------------------------------------------------------------------------
// The route: raw audio streams, JSON stays on the phone's path.
// ---------------------------------------------------------------------------

test("only an audio body diverts to the streaming exchange", () => {
  assert.match(ROUTE, /contentType\.startsWith\("audio\/"\)/);
});

test("everything else still runs the JSON handler", () => {
  assert.match(ROUTE, /return run\(request, context\)/);
});

test("the streaming path checks the device key before doing anything", () => {
  const at = ROUTE.indexOf('startsWith("audio/")');
  const auth = ROUTE.indexOf('x-pos-key');
  const work = ROUTE.indexOf('import("../../../lib/deskConverse.js")');
  assert.ok(at >= 0 && auth > at && work > auth, "auth must sit between detection and work");
});


// ---------------------------------------------------------------------------
// The exchange: shared brains, off-path writes, framed output.
// ---------------------------------------------------------------------------

test("the streaming path routes through the same router prompt as the JSON path", () => {
  assert.match(CONVERSE, /buildRouterRequest\(\{ now, userTimezone, isDesk: true, deskContext, text \}\)/);
});

test("spoken commands use the one shared matcher", () => {
  assert.match(CONVERSE, /handleDeskCommand\(text\)/);
});

test("extraction and the stash ride behind waitUntil, never the voice", () => {
  const extraction = CONVERSE.indexOf("extractDurableFacts");
  assert.ok(extraction >= 0);
  const before = CONVERSE.slice(Math.max(0, extraction - 400), extraction);
  assert.match(before, /waitUntil\(/);
  assert.match(CONVERSE, /waitUntil\(\s*stashDeskScreen/);
});

test("frames carry a one-byte type and a four-byte length", () => {
  assert.match(CONVERSE, /head\[0\] = type\.charCodeAt\(0\)/);
  assert.match(CONVERSE, /head\.writeUInt32LE\(body\.length, 1\)/);
});

test("the screen renders from the fresh spec, not a stash it might race", () => {
  assert.match(CONVERSE, /renderDeskScreen\(\{\s*spec,/);
});


// ---------------------------------------------------------------------------
// The answerer: spoken register first, and the fallback when it is not.
// ---------------------------------------------------------------------------

test("spokenFirst streams and fires onSpoken at the block marker", () => {
  assert.match(ANSWER, /stream: true/);
  assert.match(ANSWER, /onSpoken\(spoken\)/);
});

test("a model that ignores the format still yields a usable full answer", () => {
  assert.match(ANSWER, /const full = m\s*\?[\s\S]*?:\s*text\.trim\(\)/);
});

test("the default answerQuestion path is untouched by the option", () => {
  assert.match(ANSWER, /spokenFirst = false/);
});


// ---------------------------------------------------------------------------
// The face: phase frames exist for the device to cache at boot.
// ---------------------------------------------------------------------------

test("all four phase frames are defined", () => {
  for (const kind of ["phase-listening", "phase-thinking", "phase-thinking-2", "phase-speaking"]) {
    assert.ok(SCREEN.includes(`"${kind}"`), `${kind} missing from deskScreen.js`);
  }
});

test("phase frames skip the state build entirely", () => {
  const at = SCREEN.indexOf('preview.startsWith("phase-")');
  const stateAt = SCREEN.indexOf("buildDeskState({ fresh })");
  assert.ok(at >= 0 && stateAt > at, "the phase early-return must come before state");
});
