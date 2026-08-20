// Pretend to be the desk device. Speaks the exact HTTP the firmware will:
// GET /api/desk with the x-pos-key header, render what the screen would show,
// optionally ack the shown nudge.
//
//   node --env-file=.env.local dev/desk-simulator.mjs            one poll
//   node --env-file=.env.local dev/desk-simulator.mjs --watch    poll every 30s
//   node --env-file=.env.local dev/desk-simulator.mjs --ack <id> resolve a nudge
//
// BASE defaults to production; override with DESK_BASE for a local server.

const BASE = process.env.DESK_BASE || "https://personal-os-blake-007c.vercel.app";

const KEY = process.env.API_SECRET;

const headers = { "Content-Type": "application/json", ...(KEY ? { "x-pos-key": KEY } : {}) };


async function poll() {

  const res = await fetch(`${BASE}/api/desk`, { headers });

  if (!res.ok) {
    console.error(`GET /api/desk -> HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  const s = await res.json();

  // Roughly what the AMOLED renders, as terminal art.
  const ember = s.attention.count > 0;

  console.log("");
  console.log(`  [${ember ? "EMBER" : "clear"}]  ${s.ts}  (${s.tz})`);

  if (s.calendar === null) {
    console.log("  calendar: unreachable — do not render an empty day");
  } else if (s.calendar.next) {
    console.log(`  next: ${s.calendar.next.title} [${s.calendar.next.kind}] at ${s.calendar.next.at} — in ${s.calendar.next.startsInMin} min (${s.calendar.remaining} left today)`);
    console.log(`  day ends ${s.calendar.lastEnd || "?"} · evening ${s.calendar.eveningFree ? "free" : "booked"}`);
  } else {
    console.log(`  nothing left today · evening ${s.calendar.eveningFree ? "free" : "booked"}`);
  }

  if (s.brief?.lead) console.log(`  brief${s.brief.unread ? " (unread)" : ""}: ${s.brief.lead}`);

  if (s.attention.nudge) {
    console.log(`  NUDGE [${s.attention.nudge.id}]: ${s.attention.nudge.message}`);
  }

  console.log(`  waiting on you: ${s.attention.count}`);
  console.log("");

}


async function ack(id) {

  const res = await fetch(`${BASE}/api/desk`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "ack", id })
  });

  console.log(`POST ack ${id} -> HTTP ${res.status}: ${await res.text()}`);

}


const args = process.argv.slice(2);

if (args[0] === "--ack" && args[1]) {
  await ack(args[1]);
} else if (args[0] === "--watch") {
  await poll();
  setInterval(poll, 30_000);
} else {
  await poll();
}
