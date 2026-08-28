import supabase from "./supabase.js";

// The bridge between a spoken sentence and a browser tab on the laptop.
//
// The desk pushes commands here ("open this URL"); a small helper on the
// laptop polls, executes, and heartbeats. Three properties are the whole
// safety story, because the user's exact fear is the laptop "just doing
// shit" mid-exam:
//
//   1. Nothing enters this queue except an explicit spoken instruction that
//      NAMED the laptop — the tool's description forbids the router from
//      volunteering it, and there is no other writer.
//   2. Commands expire in 60 seconds. A laptop opened an hour later must
//      never replay a stale instruction; the queue is a doorbell, not a
//      mailbox.
//   3. The helper itself can be paused (a menu-line toggle on the laptop),
//      and it only ever opens http(s) URLs — no shell, no arguments.

const KEY = "laptop_queue";

// The pause flag lives in its OWN record, untouched by the drain. When it
// shared the queue's record, the helper's two-second read-modify-write
// poll raced every state change: first it erased a fresh pause (drain
// rewrote the record wholesale), and after that was patched to preserve
// fields, a drain that READ paused:true just before a spoken resume WROTE
// it back just after — resurrecting the pause. Separate rows, no shared
// write, no race to lose.
const PAUSE_KEY = "laptop_paused";

export const COMMAND_TTL_MS = 60_000;

// A helper that has polled this recently is "online"; the desk uses this to
// say "opening on your laptop" versus "your laptop helper isn't running".
const ONLINE_WINDOW_MS = 12_000;


async function load() {

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();

  return data?.value || { commands: [], last_seen: null };

}


async function store(value) {

  await supabase
    .from("app_settings")
    .upsert([{ key: KEY, value, updated_at: new Date().toISOString() }], { onConflict: "key" });

}


// The spoken switch. Server-side, so a paused system never even queues —
// and the laptop's own pause file remains the absolute override on top,
// because the person AT the machine outranks the person at the desk.
export async function setLaptopPaused(paused) {

  await supabase
    .from("app_settings")
    .upsert([{ key: PAUSE_KEY, value: { paused: Boolean(paused) }, updated_at: new Date().toISOString() }],
            { onConflict: "key" });

}


async function isPaused() {

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PAUSE_KEY)
    .maybeSingle();

  return Boolean(data?.value?.paused);

}


export async function pushLaptopCommand({ kind = "url", url = null, app = null, query = null, label = "" }) {

  // Validation by kind, so nothing malformed ever reaches the helper: URLs
  // must be http(s); app names and file queries are plain short text (the
  // helper additionally refuses anything but `open -a` and a Spotlight
  // lookup, so these are belt on top of its braces).
  const clean = (s, max) => typeof s === "string" && /^[\w .,'&()\/-]{1,80}$/.test(s.trim())
    ? s.trim().slice(0, max) : null;

  if (!["url", "app", "file"].includes(kind)) return { pushed: false };
  if (kind === "url" && !/^https?:\/\//.test(url || "")) return { pushed: false };
  if (kind === "file" && !(query = clean(query, 80))) return { pushed: false };

  // An app name rides on both "app" and "file" (the file's opener hint);
  // sanitized wherever it appears, required only when it IS the command.
  app = app ? clean(app, 40) : null;
  if (kind === "app" && !app) return { pushed: false };

  const [value, paused] = await Promise.all([load(), isPaused()]);

  if (paused) return { pushed: false, paused: true };

  const now = Date.now();

  // Fresh entries only — the push also sweeps anything already stale.
  value.commands = (value.commands || [])
    .filter(c => now - new Date(c.at).getTime() < COMMAND_TTL_MS);

  value.commands.push({
    id: `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind,
    ...(url ? { url } : {}),
    ...(app ? { app } : {}),
    ...(query ? { query } : {}),
    label: String(label).slice(0, 120),
    at: new Date(now).toISOString()
  });

  await store(value);

  return { pushed: true, online: isOnline(value) };

}


function isOnline(value) {
  return Boolean(value.last_seen) &&
    Date.now() - new Date(value.last_seen).getTime() < ONLINE_WINDOW_MS;
}


export async function laptopOnline() {
  return isOnline(await load());
}


// The helper's poll: returns everything fresh, clears the queue, records
// the heartbeat. Draining IS the acknowledgement — a command is delivered
// at most once.
export async function drainLaptopCommands() {

  const value = await load();

  const now = Date.now();

  const fresh = (value.commands || [])
    .filter(c => now - new Date(c.at).getTime() < COMMAND_TTL_MS);

  // Everything EXCEPT the queue and the heartbeat survives the drain. The
  // first version rewrote the record wholesale, which meant the helper's
  // own two-second poll silently erased the paused flag — "pause laptop
  // control" held for at most one poll cycle and then everything worked
  // again, which is worse than no pause at all.
  await store({ ...value, commands: [], last_seen: new Date(now).toISOString() });

  return fresh;

}
