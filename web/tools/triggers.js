import supabase from "../lib/supabase.js";
import { logActivity } from "./activityLog.js";
import { getUserTimezone } from "../lib/profile.js";


// The app doing things itself, at the moment they matter.
//
// ── why this exists ──────────────────────────────────────────────────────
//
// A memory sat in the database reading "around any barbell events, remind me
// prior to the event to capture media and stats for my portfolio". The system
// read it, understood it, and produced a nudge telling its owner to go and add
// a calendar reminder. The assistant asked the person to do the assistant's job.
//
// And a calendar event is the wrong artefact anyway: it is a thing you have to
// remember to look at. What is wanted is a buzz at the moment — better still,
// a buzz on WALKING INTO THE GYM, which this app can know, because Overland
// posts a location every ten minutes and eleven places already have names.
//
// ── what a trigger is ────────────────────────────────────────────────────
//
// WHEN something happens, SAY this, and optionally ASK for something back and
// keep the answers as a series. Three kinds of when: arriving somewhere, a
// stretch before a calendar event, a time of day.
//
// Nothing in this file knows about gyms, barbells or muscle-ups. That is the
// entire point — the same three columns serve "practise negatives when I get
// to the gym", "film something before the 5pm meeting", and whatever is asked
// for next, without another table or another cron.


// A place fires nothing if the last ping is older than this — he has left, and
// a trigger firing off a stale row would buzz him at home about the gym.
const STILL_HERE_MINUTES = 25;

// How wide a net the event check casts around its target moment. The cron that
// drives it runs every fifteen minutes and can be late, so a window narrower
// than the cadence silently drops firings. Wider than needed is fine — the
// cooldown is what stops a second one.
const EVENT_WINDOW_MINUTES = 20;


function tableMissing(error) {
  return error && /schema cache|does not exist|relation .* does not exist/i.test(error.message);
}


// ── numbers, parsed in code ──────────────────────────────────────────────
//
// "5 negatives and 2 assisted" becomes { negatives: 5, assisted: 2 } here,
// by regex, so a season of progress is arithmetic over real integers. Handing
// this to a model would mean a chart whose points were remembered rather than
// measured, and the whole value of the series is that it is measured.
// Words that can sit next to a number without being what it counts.
const FILLER = new Set([
  "and", "the", "of", "at", "in", "on", "for", "with", "to", "a", "an", "my",
  "it", "was", "were", "is", "are", "then", "plus", "more", "some", "about",
  "or", "but", "did", "got", "i", "we", "he", "she", "they", "today", "just"
]);


export function parseNumbers(text) {

  const source = String(text || "").toLowerCase();

  const found = {};

  // "5 negatives", "12 pull ups", "3.5 miles" — a number followed by what it
  // counts. Hyphens and spaces in the noun both collapse to an underscore so
  // "pull-ups" and "pull ups" are one series and not two.
  const pairs = source.matchAll(/(\d+(?:\.\d+)?)\s*(?:x\s*)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)/g);

  for (const [, value, rawNoun] of pairs) {

    // Strip filler from both ends rather than only the tail. "4 and then some"
    // captures "and then", and a tail-only strip leaves "and" — which then gets
    // stored as a unit, and a progress line about how many "and" he did.
    const words = rawNoun.trim().split(/\s+/).filter(Boolean);

    while (words.length && FILLER.has(words[0])) words.shift();
    while (words.length && FILLER.has(words[words.length - 1])) words.pop();

    if (words.length === 0) continue;

    const noun = words.join("_").replace(/-+/g, "_");

    // Two characters keeps "kg" and "lb" and drops the leavings of anything
    // else.
    if (noun.length < 2) continue;

    // First mention wins: "3 sets of 5 reps" should not have "reps" overwrite
    // an earlier, more specific count of the same noun.
    if (!(noun in found)) found[noun] = Number(value);

  }

  // A bare number is still an answer — "7" to "how many did you get?" means
  // seven of whatever was asked about.
  if (Object.keys(found).length === 0) {
    const bare = source.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
    if (bare) found.count = Number(bare[1]);
  }

  return Object.keys(found).length > 0 ? found : null;

}


// ── firing ───────────────────────────────────────────────────────────────

// The claim, and it is the whole safety mechanism.
//
// An INSERT against a unique index, not a comparison against a timestamp.
//
// A cooldown was the obvious design and it is wrong in both directions for
// anything calendar-driven: two events matching the same word inside one window
// (a 5pm and a 6:30pm "Gym" block) silently drop the second, while a cooldown
// short enough to allow both lets one event fire twice across two cron ticks.
// And a read-then-write on a timestamp is not a lock at all — two concurrent
// runs both read the old value and both proceed.
//
// So every occasion a trigger could fire gets a name that is stable and unique
// to it, and the database decides who won. One run gets the row, the other gets
// a 23505 and sends nothing.
//
// Three separate bugs in one week came from an alert that skipped this step,
// the worst pushing the same weekly digest seventeen times in a day. Nothing
// here sends before the claim comes back.
async function claim(trigger, fireKey) {

  const { error } = await supabase
    .from("trigger_fires")
    .insert([{ trigger_id: trigger.id, fire_key: fireKey }]);

  if (error) {

    // 23505 is the unique violation — the ordinary, expected outcome of a
    // second run reaching an occasion that has already fired.
    if (error.code === "23505" || /duplicate key/i.test(error.message)) return false;

    if (tableMissing(error)) return false;

    console.error("TRIGGER CLAIM FAILED:", error.message);

    return false;

  }

  // Heartbeat only, and deliberately after the claim: if this fails the lock
  // still holds and nothing double-fires. It exists so a trigger that has
  // quietly stopped working is visible on the settings page.
  await supabase
    .from("triggers")
    .update({
      last_fired_at: new Date().toISOString(),
      fire_count: (trigger.fire_count || 0) + 1
    })
    .eq("id", trigger.id)
    .then(({ error: beat }) => {
      if (beat) console.error("TRIGGER HEARTBEAT FAILED:", beat.message);
    });

  return true;

}


// Fire one trigger: claim it, put a card where the answer can be typed, buzz
// the phone.
//
// The card comes before the push on purpose. A push is a thing you swipe away;
// the card is where the question actually lives, and if writing it fails there
// is nothing worth buzzing about.
export async function fireTrigger(trigger, { reason = null, fireKey }) {

  if (!fireKey) throw new Error("fireTrigger needs a fireKey — it is the lock.");

  if (!(await claim(trigger, fireKey))) return { fired: false, skipped: "already fired" };

  const { data: card, error: cardError } = await supabase
    .from("prompts")
    .insert([{
      kind: "check_in",
      title: trigger.label,
      body: trigger.asks ? `${trigger.message}\n\n${trigger.asks}` : trigger.message,
      payload: {
        trigger_id: trigger.id,
        asks: trigger.asks || null,
        log_kind: trigger.log_kind || null,
        subject_type: trigger.subject_type || null,
        subject_id: trigger.subject_id || null,
        reason
      },
      status: "pending",
      pushed_at: new Date().toISOString()
    }])
    .select("id")
    .single();

  if (cardError) {
    console.error("TRIGGER CARD FAILED:", cardError.message);
    return { fired: false, error: cardError.message };
  }

  // The buzz is gated; the card above never is. Turning the interruption dial
  // down means "stop interrupting me", not "stop keeping track" — and an
  // unclassified urgency string is refused loudly by pushAllowed rather than
  // silently swallowed, which is why check_in is declared in URGENCY_TIERS.
  const { pushAllowed } = await import("../lib/settings.js");

  let pushed = false;

  if (await pushAllowed("check_in")) {

    const { sendPush } = await import("../lib/push.js");

    await sendPush({
      title: trigger.label,
      body: trigger.asks ? `${trigger.message} ${trigger.asks}` : trigger.message,
      url: "/",
      // Its own tag per firing. A stable tag REPLACES the previous notification,
      // so a second gym arrival would silently wipe the first one he had not
      // answered yet — the same mechanism that hid sixteen of seventeen copies
      // of the weekly digest.
      tag: `trigger-${trigger.id}-${Date.now()}`
    }).catch(error => console.error("TRIGGER PUSH FAILED:", error.message));

    pushed = true;

  }

  await logActivity({
    action: "trigger_fired",
    input: { trigger_id: trigger.id, kind: trigger.kind, reason },
    output: { label: trigger.label, prompt_id: card.id, asked: Boolean(trigger.asks), pushed },
    success: true,
    source: "cron"
  }).catch(() => {});

  return { fired: true, prompt_id: card.id, pushed };

}


// ── place arrival ────────────────────────────────────────────────────────

// Called from ingestLocationPoints with every place touched by the batch.
//
// Not only the new arrivals: a trigger with a dwell has to be re-checked on
// each ping, because "he has been at the gym for ten minutes" only becomes
// true on a ping that arrives ten minutes after the one that got him there.
export async function runPlaceTriggers({ placeIds = [] } = {}) {

  if (placeIds.length === 0) return { checked: 0, fired: 0 };

  const { data: triggers, error } = await supabase
    .from("triggers")
    .select("*")
    .eq("kind", "place_arrival")
    .eq("active", true)
    .in("place_id", placeIds);

  if (error) {
    if (tableMissing(error)) return { checked: 0, fired: 0, skipped: "not set up yet" };
    console.error("PLACE TRIGGERS READ FAILED:", error.message);
    return { checked: 0, fired: 0, error: error.message };
  }

  if (!triggers?.length) return { checked: 0, fired: 0 };

  const { data: places } = await supabase
    .from("places")
    .select("id, label, arrived_at, last_seen_at")
    .in("id", placeIds);

  const byId = new Map((places || []).map(p => [p.id, p]));

  const now = Date.now();

  let fired = 0;

  for (const trigger of triggers) {

    const place = byId.get(trigger.place_id);

    if (!place?.arrived_at) continue;

    // Still there? last_seen_at is the most recent ping inside the radius, so
    // a stale one means he has gone and this would be a buzz about a room he
    // is not in.
    const sinceSeen = (now - new Date(place.last_seen_at).getTime()) / 60000;

    if (sinceSeen > STILL_HERE_MINUTES) continue;

    // Long enough to count as being here rather than walking past it. The gym
    // is a hundred metres from the path to class; without this it would fire
    // on the walk.
    const dwelt = (now - new Date(place.arrived_at).getTime()) / 60000;

    if (dwelt < (trigger.dwell_minutes || 0)) continue;

    // Keyed on the visit, not the clock: walking back past the gym tomorrow
    // is a new arrived_at and therefore a new occasion, while every ping of
    // THIS visit resolves to the same key and claims nothing.
    const result = await fireTrigger(trigger, {
      reason: `at ${place.label || "a saved place"}`,
      fireKey: `place:${place.id}:${place.arrived_at}`
    });

    if (result.fired) fired += 1;

  }

  return { checked: triggers.length, fired };

}


// ── before a calendar event ──────────────────────────────────────────────

export async function runEventTriggers({ tz = null } = {}) {

  const { data: triggers, error } = await supabase
    .from("triggers")
    .select("*")
    .eq("kind", "before_event")
    .eq("active", true);

  if (error) {
    if (tableMissing(error)) return { checked: 0, fired: 0, skipped: "not set up yet" };
    throw new Error(error.message);
  }

  if (!triggers?.length) return { checked: 0, fired: 0 };

  const zone = tz || await getUserTimezone();

  const { DateTime } = await import("luxon");

  const now = DateTime.now().setZone(zone);

  const today = now.toISODate();

  // Tomorrow as well: a trigger with a long lead on a 7am event has to be
  // seen the night before.
  const { getEvents } = await import("./googleCalendar.js");

  let events = [];

  try {

    const result = await getEvents({
      startDate: today,
      endDate: now.plus({ days: 1 }).toISODate(),
      timezone: zone,
      maxResults: 100
    });

    events = result?.events || [];

  } catch (error) {

    // Google expiring must not take the whole cron down, and must not go
    // unnoticed either — lib/google.js already raises its own alert, so this
    // reports and returns rather than throwing.
    console.error("EVENT TRIGGERS: calendar unavailable —", error.message);

    return { checked: triggers.length, fired: 0, error: "calendar unavailable" };

  }

  // An all-day event has a date and no time, so "thirty minutes before" would
  // mean 11:30pm the night before. Nothing here can act on that sensibly.
  const timed = events.filter(e => !e.allDay && e.start);

  let fired = 0;

  for (const trigger of triggers) {

    const needle = String(trigger.event_match || "").trim().toLowerCase();

    if (!needle) continue;

    for (const event of timed) {

      if (!String(event.title || "").toLowerCase().includes(needle)) continue;

      const start = DateTime.fromISO(event.start, { zone });

      if (!start.isValid) continue;

      const target = start.minus({ minutes: trigger.lead_minutes ?? 30 });

      // A window, not an instant. The cron ticks every fifteen minutes and is
      // sometimes late, so an equality test drops firings silently. Opening at
      // the target and closing at the event itself means a late tick still
      // catches it, and the cooldown stops the second one.
      const minutesPastTarget = now.diff(target, "minutes").minutes;

      if (minutesPastTarget < 0) continue;
      if (minutesPastTarget > Math.max(EVENT_WINDOW_MINUTES, trigger.lead_minutes ?? 30)) continue;
      if (now > start) continue;

      // singleEvents:true means Google hands back an expanded INSTANCE id,
      // so every Wednesday's meeting is its own occasion and two different
      // events matching the same word on one day never collide.
      const result = await fireTrigger(trigger, {
        reason: `before ${event.title}`,
        fireKey: `event:${event.id}`
      });

      if (result.fired) fired += 1;

      break;

    }

  }

  return { checked: triggers.length, fired };

}


// ── a time of day ────────────────────────────────────────────────────────

export async function runTimeTriggers({ tz = null } = {}) {

  const { data: triggers, error } = await supabase
    .from("triggers")
    .select("*")
    .eq("kind", "time_of_day")
    .eq("active", true);

  if (error) {
    if (tableMissing(error)) return { checked: 0, fired: 0, skipped: "not set up yet" };
    throw new Error(error.message);
  }

  if (!triggers?.length) return { checked: 0, fired: 0 };

  const zone = tz || await getUserTimezone();

  const { DateTime } = await import("luxon");

  const now = DateTime.now().setZone(zone);

  let fired = 0;

  for (const trigger of triggers) {

    const match = String(trigger.at_time || "").match(/^(\d{1,2}):(\d{2})$/);

    if (!match) continue;

    if (Array.isArray(trigger.days_of_week) && trigger.days_of_week.length > 0
        && !trigger.days_of_week.includes(now.weekday)) continue;

    const target = now.set({ hour: Number(match[1]), minute: Number(match[2]), second: 0, millisecond: 0 });

    const minutesPast = now.diff(target, "minutes").minutes;

    // Same window reasoning as the event check: past the time, but not so far
    // past that a cron catching up would buzz about this morning at midnight.
    if (minutesPast < 0 || minutesPast > EVENT_WINDOW_MINUTES) continue;

    const result = await fireTrigger(trigger, {
      reason: `${trigger.at_time}`,
      fireKey: `time:${now.toISODate()}:${trigger.at_time}`
    });

    if (result.fired) fired += 1;

  }

  return { checked: triggers.length, fired };

}


// ── the answer coming back ───────────────────────────────────────────────

// What a check_in card does with what he types.
//
// The row is the point. A reminder that is only a reminder is a notification;
// a reminder that keeps the answer is a record of a season.
export async function recordTriggerResponse({ prompt_id, answer }) {

  const { data: prompt, error: readError } = await supabase
    .from("prompts")
    .select("id, payload, title")
    .eq("id", prompt_id)
    .single();

  if (readError) throw new Error(readError.message);

  const triggerId = prompt?.payload?.trigger_id || null;

  const said = String(answer || "").trim();

  const dismissed = !said || said.toLowerCase() === "dismissed";

  // Nothing typed is not nothing learnt — it means the trigger fired and got
  // no answer, which is worth seeing when deciding whether it earns its place.
  if (triggerId && !dismissed) {

    const numbers = parseNumbers(said);

    const { error } = await supabase.from("trigger_logs").insert([{
      trigger_id: triggerId,
      prompt_id,
      response: said,
      numbers
    }]);

    if (error && !tableMissing(error)) {
      console.error("TRIGGER LOG FAILED:", error.message);
    }

  }

  await supabase
    .from("prompts")
    .update({
      status: "answered",
      answer: said || "dismissed",
      answered_at: new Date().toISOString()
    })
    .eq("id", prompt_id);

  if (dismissed) return { success: true, message: "Cleared." };

  const numbers = parseNumbers(said);

  const history = triggerId ? await progressFor(triggerId) : null;

  return {
    success: true,
    message: history?.line ? `Logged. ${history.line}` : "Logged.",
    data: { numbers, history }
  };

}


// What the series says so far, in one line.
//
// Every comparison here is arithmetic over stored integers — the model is
// never asked what the numbers were.
export async function progressFor(triggerId) {

  const { data, error } = await supabase
    .from("trigger_logs")
    .select("response, numbers, occurred_at")
    .eq("trigger_id", triggerId)
    .order("occurred_at", { ascending: false })
    .limit(30);

  if (error || !data?.length) return null;

  const entries = data.length;

  // Which number is the POINT of the entry.
  //
  // Frequency alone is not enough and got this visibly wrong: "5 negatives, 2
  // assisted" then "8 negatives, 1 assisted" tallies both units twice, the tie
  // broke arbitrarily on "assisted", and the line read "1 assisted — best 2,
  // down 1 from your first" — reporting a session that went 5 to 8 negatives
  // with fewer assists as if he had gone backwards on both counts.
  //
  // The tie-break is the order he said them in: people lead with the number
  // that matters. That order cannot come from `numbers`, because jsonb does not
  // preserve key order — Postgres sorts the keys — so it is re-derived from the
  // response text, which does.
  const order = data.map(r => Object.keys(parseNumbers(r.response) || {}));

  const tally = {};

  for (const keys of order) {
    for (const key of keys) tally[key] = (tally[key] || 0) + 1;
  }

  // Average position across the entries that mention it: lower is more often
  // the thing he led with.
  const lead = {};

  for (const key of Object.keys(tally)) {
    const spots = order.map(keys => keys.indexOf(key)).filter(i => i >= 0);
    lead[key] = spots.reduce((a, b) => a + b, 0) / spots.length;
  }

  const unit = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || lead[a] - lead[b])[0] || null;

  if (!unit) return { entries, line: `${entries} logged so far.` };

  const series = data
    .filter(r => typeof r.numbers?.[unit] === "number")
    .map(r => ({ value: r.numbers[unit], at: r.occurred_at }));

  if (series.length < 2) {
    return {
      entries,
      unit,
      line: series.length
        ? `First one on the board — ${series[0].value} ${unit.replace(/_/g, " ")}.`
        : "First one on the board."
    };
  }

  const latest = series[0].value;
  const best = Math.max(...series.map(s => s.value));
  const first = series[series.length - 1].value;

  const label = unit.replace(/_/g, " ");

  const change = latest - first;

  return {
    entries,
    unit,
    latest,
    best,
    first,
    line: `${latest} ${label} — best ${best}, ${change === 0 ? "level with" : change > 0 ? `up ${change} from` : `down ${Math.abs(change)} from`} your first.`
  };

}


// ── creating one ─────────────────────────────────────────────────────────

// Resolve a place by what it is called, so "the gym" finds "Campus Rec Center
// (gym)". Substring both ways, because a spoken name is rarely the stored one.
export async function findPlaceByName(name) {

  const wanted = String(name || "").trim().toLowerCase();

  if (!wanted) return null;

  const { data } = await supabase
    .from("places")
    .select("id, label")
    .not("label", "is", null);

  const places = data || [];

  return places.find(p => p.label.toLowerCase() === wanted)
    || places.find(p => p.label.toLowerCase().includes(wanted) || wanted.includes(p.label.toLowerCase()))
    || null;

}


export async function createTrigger(spec) {

  const row = {
    kind: spec.kind,
    label: spec.label,
    message: spec.message,
    asks: spec.asks || null,
    log_kind: spec.log_kind || null,
    subject_type: spec.subject_type || null,
    subject_id: spec.subject_id ? String(spec.subject_id) : null,
    source: spec.source || "capture",
    ...(spec.place_id ? { place_id: spec.place_id } : {}),
    ...(Number.isFinite(spec.dwell_minutes) ? { dwell_minutes: spec.dwell_minutes } : {}),
    ...(spec.event_match ? { event_match: spec.event_match } : {}),
    ...(Number.isFinite(spec.lead_minutes) ? { lead_minutes: spec.lead_minutes } : {}),
    ...(spec.at_time ? { at_time: spec.at_time } : {}),
    ...(Array.isArray(spec.days_of_week) && spec.days_of_week.length ? { days_of_week: spec.days_of_week } : {}),
    ...(Number.isFinite(spec.cooldown_minutes) ? { cooldown_minutes: spec.cooldown_minutes } : {})
  };

  const { data, error } = await supabase.from("triggers").insert([row]).select().single();

  if (error) {
    if (tableMissing(error)) {
      return { success: false, error: "The triggers table doesn't exist yet — run docs/schema-triggers.sql in Supabase." };
    }
    throw new Error(error.message);
  }

  return { success: true, trigger: data };

}


// ── what the rest of the app can see ─────────────────────────────────────

export async function getTriggers({ activeOnly = true } = {}) {

  let query = supabase.from("triggers").select("*").order("created_at", { ascending: false });

  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query;

  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }

  return data || [];

}


export async function setTriggerActive({ id, active }) {

  const { error } = await supabase.from("triggers").update({ active }).eq("id", id);

  if (error) throw new Error(error.message);

  return { success: true };

}


// One line for lib/signals.js, so everything that reasons about him knows what
// he has standing instructions for. Null rather than an empty sentence when
// there are none — a signal must never manufacture content.
export async function triggerSignal() {

  const triggers = await getTriggers({ activeOnly: true }).catch(() => []);

  if (triggers.length === 0) return null;

  const described = triggers.slice(0, 6).map(t => {
    const when = t.kind === "place_arrival" ? "on arriving somewhere"
      : t.kind === "before_event" ? `${t.lead_minutes}m before "${t.event_match}"`
      : `at ${t.at_time}`;
    return `${t.label} (${when})`;
  });

  return `Standing reminders the app runs itself: ${described.join("; ")}.`;

}
