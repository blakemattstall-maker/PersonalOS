// Prove the device's audio diet end-to-end: request WAV TTS the way the
// firmware will, and verify the bytes are a real RIFF/WAVE stream.
//
//   node --env-file=.env.local dev/test-tts-wav.mjs

const BASE = process.env.DESK_BASE || "https://personal-os-blake-007c.vercel.app";

const res = await fetch(`${BASE}/api/tts`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-pos-key": process.env.API_SECRET },
  body: JSON.stringify({ text: "Desk unit audio path confirmed.", format: "wav" })
});

console.log("HTTP", res.status, "| Content-Type:", res.headers.get("content-type"));

const buf = Buffer.from(await res.arrayBuffer());

console.log("bytes:", buf.length);
console.log("magic:", buf.subarray(0, 4).toString(), buf.subarray(8, 12).toString());
console.log("data marker at:", buf.indexOf("data"));
console.log("sample rate:", buf.readUInt32LE(24), "channels:", buf.readUInt16LE(22));
