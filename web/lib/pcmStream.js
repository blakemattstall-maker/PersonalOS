// Streaming 24kHz -> 16kHz PCM, for audio that is still arriving.
//
// The batch resampler in app/api/tts/route.js needs the whole file before it
// can start, which is exactly the property the desk's streaming exchange
// exists to remove: the device should be speaking ~half a second after the
// first synthesized bytes exist, not after the last ones do.
//
// Same signal path as the batch version — 9-tap Hamming-windowed sinc at
// ~7kHz, then 2:3 linear interpolation — carried across chunk boundaries.
// Two pieces of state make that correct where a naive per-chunk filter is
// audibly wrong at every seam:
//
//   - a byte carry, because a network chunk can end halfway through a 16-bit
//     sample, and
//   - a sample tail, because the filter kernel reaches 4 samples either side
//     of the point it is computing, so the last few input samples of one
//     chunk are consumed again by the first outputs of the next.
//
// The test suite holds this to "byte-identical to the batch path" on random
// chunkings, which is the only spec worth having for a resampler.

const TAPS = 9;
const HALF = (TAPS - 1) / 2;   // 4 samples of reach either side

function buildKernel() {

  const cutoff = 7000 / 24000;

  const kernel = [];
  let sum = 0;

  for (let i = 0; i < TAPS; i++) {
    const x = i - HALF;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (TAPS - 1));
    kernel.push(sinc * w);
    sum += sinc * w;
  }

  for (let i = 0; i < TAPS; i++) kernel[i] /= sum;

  return kernel;

}

const KERNEL = buildKernel();


export class Downsampler24to16 {

  constructor() {

    // Input samples not yet fully consumed, starting at absolute input index
    // `base`. Out-of-range reads (before the start of the stream, or past the
    // end at flush) are zero, matching the batch version's sampleAt().
    this.pending = [];
    this.base = 0;

    // How many output samples have been produced so far — the next one is
    // centred on input position outCount * 1.5.
    this.outCount = 0;

    this.byteCarry = null;

    this.flushed = false;

  }

  // Feed bytes as they arrive; returns a Buffer of 16kHz output (possibly
  // empty — a tiny chunk may not unlock any new output).
  push(bytes) {

    if (this.flushed) throw new Error("Downsampler already flushed");

    let buf = this.byteCarry ? Buffer.concat([this.byteCarry, bytes]) : bytes;

    const whole = buf.length - (buf.length % 2);

    this.byteCarry = whole < buf.length ? buf.subarray(whole) : null;

    for (let i = 0; i < whole; i += 2) {
      this.pending.push(buf.readInt16LE(i));
    }

    return this.#produce(false);

  }

  // The stream is over: everything beyond the end reads as zero, exactly as
  // the batch version treats indices past the input. Total output length is
  // floor(inSamples * 2/3), matching batch.
  flush() {

    this.flushed = true;

    return this.#produce(true);

  }

  #sampleAt(abs) {
    const i = abs - this.base;
    if (i < 0 || i >= this.pending.length) return 0;
    return this.pending[i];
  }

  #filtered(centre) {
    let acc = 0;
    for (let k = 0; k < TAPS; k++) {
      acc += KERNEL[k] * this.#sampleAt(centre + k - HALF);
    }
    return acc;
  }

  #produce(final) {

    const totalIn = this.base + this.pending.length;

    // Output i needs filtered(a) and filtered(a+1) where a = floor(i*1.5):
    // input up to a+1+HALF. Without `final`, only emit outputs whose full
    // kernel support has arrived; with it, emit everything the batch version
    // would (floor(total * 2/3) outputs), zeros past the end.
    const limit = final
      ? Math.floor(totalIn * 2 / 3)
      : (() => {
          let n = 0;
          while (Math.floor((this.outCount + n) * 1.5) + 1 + HALF < totalIn) n++;
          return this.outCount + n;
        })();

    if (limit <= this.outCount) return Buffer.alloc(0);

    const out = Buffer.alloc((limit - this.outCount) * 2);

    for (let i = this.outCount, j = 0; i < limit; i++, j += 2) {

      const src = i * 1.5;
      const a = Math.floor(src);
      const t = src - a;

      const sample = this.#filtered(a) * (1 - t) + this.#filtered(a + 1) * t;

      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), j);

    }

    this.outCount = limit;

    // Keep only what future outputs can still reach: the next output is
    // centred at floor(outCount*1.5), and its kernel reaches HALF samples back.
    const keepFrom = Math.max(this.base, Math.floor(this.outCount * 1.5) - HALF);

    if (keepFrom > this.base) {
      this.pending.splice(0, keepFrom - this.base);
      this.base = keepFrom;
    }

    return out;

  }

}


// The batch reference, for tests: one call, whole signal. Mirrors the maths
// in app/api/tts/route.js exactly (headerless — raw PCM in, raw PCM out).
export function downsampleBatch24to16(pcm) {

  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.floor(inSamples * 2 / 3);

  const out = Buffer.alloc(outSamples * 2);

  const sampleAt = (i) => (i < 0 || i >= inSamples) ? 0 : pcm.readInt16LE(i * 2);

  const filtered = (centre) => {
    let acc = 0;
    for (let k = 0; k < TAPS; k++) acc += KERNEL[k] * sampleAt(centre + k - HALF);
    return acc;
  };

  for (let i = 0; i < outSamples; i++) {
    const src = i * 1.5;
    const a = Math.floor(src);
    const t = src - a;
    const sample = filtered(a) * (1 - t) + filtered(a + 1) * t;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
  }

  return out;

}
