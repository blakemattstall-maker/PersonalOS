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


export async function pushLaptopCommand({ url, label = "" }) {

  if (!/^https?:\/\//.test(url || "")) return { pushed: false };

  const value = await load();

  const now = Date.now();

  // Fresh entries only — the push also sweeps anything already stale.
  value.commands = (value.commands || [])
    .filter(c => now - new Date(c.at).getTime() < COMMAND_TTL_MS);

  value.commands.push({
    id: `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    url,
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

  await store({ commands: [], last_seen: new Date(now).toISOString() });

  return fresh;

}
