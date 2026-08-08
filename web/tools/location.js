import supabase from "../lib/supabase.js";
import tzLookup from "tz-lookup";
import { DateTime } from "luxon";
import { getProfile, clearProfileCache, FALLBACK_TIMEZONE } from "../lib/profile.js";
import { sendPush } from "../lib/push.js";
import { pushAllowed } from "../lib/settings.js";


// Location ingest and place recognition.
//
// Raw coordinates are close to useless on their own — "you were at 40.5142,
// -88.9906" tells the system nothing. What makes location worth collecting is
// PLACES: a cluster of repeat visits the user has given a name and a purpose
// ("general education building — math 9am, english 3pm"). Only then can it say
// "you haven't been to the gym in nine days" or "you're near the hardware store
// and it's in budget."
//
// So this does three things: store points, group them into places, and — once a
// place has been visited enough times to matter — raise a prompt asking what it
// is. The user never labels anything up front.

const EARTH_RADIUS_M = 6371000;

// Roughly a building. Tight enough that the gym and the cafe next door stay
// distinct, loose enough to absorb GPS drift indoors.
const DEFAULT_RADIUS_M = 120;

// A return after this long counts as a new visit rather than the same one.
// Without it, a point every 15 minutes would report 32 "visits" to your own bed.
const REVISIT_GAP_HOURS = 3;

// Ask about a place only once it's clearly part of the user's routine.
const VISITS_BEFORE_ASKING = 3;


function distanceMeters(aLat, aLon, bLat, bLon) {

  const toRad = d => (d * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));

}


async function findNearbyPlace(lat, lon) {

  // The dataset is one person's places — tens, not thousands — so a full scan
  // beats requiring PostGIS.
  const { data } = await supabase
    .from("places")
    .select("id, latitude, longitude, radius_meters, visit_count, needs_label, last_seen_at, label");

  if (!data) return null;

  let best = null;
  let bestDistance = Infinity;

  for (const place of data) {
    const d = distanceMeters(lat, lon, place.latitude, place.longitude);
    if (d <= (place.radius_meters || DEFAULT_RADIUS_M) && d < bestDistance) {
      best = place;
      bestDistance = d;
    }
  }

  return best;

}


// A place is only created once the user has been somewhere on separate
// occasions — otherwise every petrol station on a road trip becomes a "place".
async function shouldCreatePlace(lat, lon, recordedAt) {

  const since = DateTime.fromJSDate(recordedAt).minus({ days: 21 }).toISO();

  const { data } = await supabase
    .from("location_points")
    .select("latitude, longitude, recorded_at")
    .is("place_id", null)
    .gte("recorded_at", since)
    .limit(2000);

  if (!data) return false;

  const nearby = data.filter(
    p => distanceMeters(lat, lon, p.latitude, p.longitude) <= DEFAULT_RADIUS_M
  );

  const distinctDays = new Set(
    nearby.map(p => String(p.recorded_at).slice(0, 10))
  );

  return distinctDays.size >= 2;

}


async function raiseLabelPrompt(place, tz) {

  const { data: existing } = await supabase
    .from("prompts")
    .select("id")
    .eq("kind", "label_place")
    .eq("status", "pending")
    .contains("payload", { place_id: place.id })
    .limit(1);

  if (existing && existing.length > 0) return false;

  // Times of day make it identifiable — "weekdays around 9am and 3pm" is a far
  // better clue than a coordinate.
  const { data: points } = await supabase
    .from("location_points")
    .select("recorded_at")
    .eq("place_id", place.id)
    .order("recorded_at", { ascending: false })
    .limit(200);

  const hours = (points || []).map(p =>
    DateTime.fromISO(p.recorded_at).setZone(tz).hour
  );

  const hourSummary = hours.length
    ? `Usually there around ${[...new Set(hours.map(h => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`))].slice(0, 4).join(", ")}.`
    : "";

  const maps = `https://maps.google.com/?q=${place.latitude},${place.longitude}`;

  const title = "What is this place?";
  const body = `You've been here ${place.visit_count} times. ${hourSummary} What is it, and what do you do there?`;

  await supabase.from("prompts").insert([{
    kind: "label_place",
    title,
    body,
    payload: { place_id: place.id, latitude: place.latitude, longitude: place.longitude, maps_url: maps },
    status: "pending"
  }]);

  // This never pushed at all before — the only way to find out was to have
  // the dashboard open when a place crossed the visit threshold, so in
  // practice it sat unnoticed until stumbled on days later. Same urgency
  // tier as a nudge: not the daily digest, not time-critical, so it reaches
  // the phone at "everything" and stays dashboard-only at digest_plus_urgent.
  if (await pushAllowed("nudge")) {

    await sendPush({
      title,
      body: `You've been here ${place.visit_count} times. What is it?`,
      url: "/",
      tag: `place-${place.id}`
    }).catch(error => {
      console.error("PLACE PROMPT PUSH FAILED:", error.message);
    });

  }

  return true;

}


// The user asked for the timezone to follow him rather than being edited by
// hand. It must only move once he has actually settled somewhere: a layover, a
// drive through a zone boundary, or a single stray point should never rewrite
// it. Getting this wrong shifts every displayed time and every date the router
// resolves — during testing one synthetic point moved a real profile two zones.
//
// So: require agreement across the recent history, spanning enough hours that a
// flight or a day trip can't trigger it.
const TZ_SETTLE_HOURS = 18;
const TZ_MIN_POINTS = 6;

async function maybeUpdateTimezone(lat, lon) {

  let zone;

  try {
    zone = tzLookup(lat, lon);
  } catch {
    return null;
  }

  const profile = await getProfile();

  if (!profile || profile.timezone === zone) return null;


  const since = DateTime.now().minus({ hours: TZ_SETTLE_HOURS }).toISO();

  const { data: recent } = await supabase
    .from("location_points")
    .select("latitude, longitude, recorded_at")
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(200);

  if (!recent || recent.length < TZ_MIN_POINTS) return null;

  const zones = new Set();

  for (const p of recent) {
    try {
      zones.add(tzLookup(p.latitude, p.longitude));
    } catch {
      return null;
    }
  }

  // Any disagreement means still in motion — wait until it settles.
  if (zones.size !== 1 || !zones.has(zone)) return null;

  const span = DateTime.fromISO(recent[0].recorded_at)
    .diff(DateTime.fromISO(recent[recent.length - 1].recorded_at), "hours").hours;

  if (span < TZ_SETTLE_HOURS / 2) return null;

  const { error } = await supabase
    .from("profiles")
    .update({ timezone: zone })
    .eq("id", profile.id);

  if (error) {
    console.error("TIMEZONE UPDATE FAILED:", error.message);
    return null;
  }

  clearProfileCache();

  return { from: profile.timezone, to: zone };

}


export async function ingestLocationPoints(rawPoints) {

  if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
    return { success: true, stored: 0 };
  }

  const profile = await getProfile();
  const tz = profile?.timezone || FALLBACK_TIMEZONE;

  let stored = 0;
  let newPlaces = 0;
  let prompted = 0;
  let timezoneChange = null;

  // Oldest first so revisit detection sees time moving forward.
  const points = rawPoints
    .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));


  for (const point of points) {

    const recordedAt = new Date(point.recorded_at);

    let place = await findNearbyPlace(point.latitude, point.longitude);


    if (place) {

      const gapHours = place.last_seen_at
        ? DateTime.fromJSDate(recordedAt).diff(DateTime.fromISO(place.last_seen_at), "hours").hours
        : Infinity;

      const isNewVisit = gapHours >= REVISIT_GAP_HOURS;

      const visitCount = place.visit_count + (isNewVisit ? 1 : 0);

      await supabase
        .from("places")
        .update({ last_seen_at: recordedAt.toISOString(), visit_count: visitCount })
        .eq("id", place.id);

      place = { ...place, visit_count: visitCount };

    } else if (await shouldCreatePlace(point.latitude, point.longitude, recordedAt)) {

      const { data: created } = await supabase
        .from("places")
        .insert([{
          latitude: point.latitude,
          longitude: point.longitude,
          radius_meters: DEFAULT_RADIUS_M,
          visit_count: 2,
          needs_label: true,
          last_seen_at: recordedAt.toISOString()
        }])
        .select()
        .single();

      place = created;
      newPlaces += 1;

      // Adopt the earlier unassigned points that formed this cluster, so the
      // place's history doesn't start from the moment it was recognised.
      if (created) {
        const { data: orphans } = await supabase
          .from("location_points")
          .select("id, latitude, longitude")
          .is("place_id", null)
          .limit(2000);

        const belong = (orphans || [])
          .filter(o => distanceMeters(point.latitude, point.longitude, o.latitude, o.longitude) <= DEFAULT_RADIUS_M)
          .map(o => o.id);

        if (belong.length) {
          await supabase.from("location_points").update({ place_id: created.id }).in("id", belong);
        }
      }

    }


    const { error } = await supabase.from("location_points").insert([{
      recorded_at: recordedAt.toISOString(),
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy_m: point.accuracy_m ?? null,
      speed_mps: point.speed_mps ?? null,
      battery: point.battery ?? null,
      place_id: place?.id ?? null
    }]);

    if (!error) stored += 1;


    if (place?.needs_label && place.visit_count >= VISITS_BEFORE_ASKING) {
      if (await raiseLabelPrompt(place, tz)) prompted += 1;
    }

  }


  const last = points[points.length - 1];

  if (last) {
    timezoneChange = await maybeUpdateTimezone(last.latitude, last.longitude);
  }


  return {
    success: true,
    stored,
    newPlaces,
    labelPromptsRaised: prompted,
    timezoneChange
  };

}


// Overland batches points as a GeoJSON FeatureCollection.
export function parseOverlandPayload(body) {

  const locations = body?.locations || [];

  return locations.map(f => ({
    latitude: f.geometry?.coordinates?.[1],
    longitude: f.geometry?.coordinates?.[0],
    recorded_at: f.properties?.timestamp || new Date().toISOString(),
    accuracy_m: f.properties?.horizontal_accuracy ?? null,
    speed_mps: f.properties?.speed >= 0 ? f.properties.speed : null,
    battery: f.properties?.battery_level ?? null
  })).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

}


export async function answerPlaceLabel({ prompt_id, answer }) {

  const { data: prompt } = await supabase
    .from("prompts")
    .select("id, payload")
    .eq("id", prompt_id)
    .single();

  if (!prompt) throw new Error("Prompt not found.");

  const placeId = prompt.payload?.place_id;

  if (placeId) {

    await supabase
      .from("places")
      .update({ label: answer, notes: answer, needs_label: false })
      .eq("id", placeId);

    // Self-healing: raiseLabelPrompt's own dedup should prevent more than one
    // pending prompt per place, but there's no unique constraint backing that
    // up in the database. If concurrent Overland deliveries ever raced past
    // it, answering one duplicate would leave the other sitting there
    // forever, indistinguishable from a fresh question — resolve every
    // pending prompt for this place, not just the one that was clicked.
    const { data: siblings } = await supabase
      .from("prompts")
      .select("id")
      .eq("kind", "label_place")
      .eq("status", "pending")
      .contains("payload", { place_id: placeId });

    const siblingIds = (siblings || []).map(s => s.id).filter(id => id !== prompt_id);

    if (siblingIds.length > 0) {
      await supabase
        .from("prompts")
        .update({ status: "answered", answer, answered_at: new Date().toISOString() })
        .in("id", siblingIds);
    }

  }

  await supabase
    .from("prompts")
    .update({ status: "answered", answer, answered_at: new Date().toISOString() })
    .eq("id", prompt_id);

  return { success: true, message: `Got it — labelled as "${answer}".` };

}
