import { requireAuth } from "../../lib/auth.js";
import { ingestLocationPoints, parseOverlandPayload } from "../../tools/location.js";
import { saveSubscription, publicKey } from "../../lib/push.js";
import { logActivity } from "../../tools/activityLog.js";
import { buildDiagnostics } from "../../lib/diagnostics.js";


// One function for everything that pushes data INTO the system, rather than one
// per source. Vercel Hobby allows 12 serverless functions and this project runs
// close to that ceiling, so a dynamic segment keeps location ingest, push
// registration and the VAPID key handout at a single function.


// Overland's failure mode is silence: it queues points on the phone and, if the
// URL is wrong or tracking is off, simply never calls. From the server that is
// indistinguishable from "he hasn't moved". So every single delivery is logged,
// including ones that produced nothing, and a GET returns the current state in
// plain language — openable on the phone itself, which is where the problem
// always is.
async function locationStatus(req, res) {

  const { location } = await buildDiagnostics();

  return res.status(200).json({
    endpoint: "ok",
    ...location,
    hint: location.points === 0 && location.deliveryAttempts === 0
      ? "Nothing has ever POSTed here. In Overland: check the Receiver Endpoint URL exactly matches this one including ?key=, tracking is toggled on, and iOS location permission is Always."
      : undefined
  });

}


async function location(req, res) {

  if (req.method === "GET") return locationStatus(req, res);

  const started = Date.now();

  // Overland batches points as a GeoJSON FeatureCollection; a plain array is
  // accepted too so the endpoint can be driven from a Shortcut or curl.
  const raw = req.body;

  const points = Array.isArray(raw) ? raw : parseOverlandPayload(raw);

  let result;
  let failure = null;

  try {

    result = await ingestLocationPoints(points);

  } catch (error) {

    failure = error;
    result = { success: false, stored: 0, error: error.message };

  }


  // Logged separately from the ingest itself so a logging failure can never
  // cost us the points, and so a delivery that parsed to nothing still leaves a
  // trace — that case is the whole reason this exists.
  try {

    await logActivity({
      action: "location_ingest",
      source: "overland",
      success: !failure,
      duration_ms: Date.now() - started,
      error_message: failure?.message || null,
      input: JSON.stringify({
        shape: Array.isArray(raw) ? "array" : typeof raw,
        keys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw).slice(0, 10) : null,
        rawCount: Array.isArray(raw) ? raw.length : (raw?.locations?.length ?? null),
        parsedCount: points.length,
        userAgent: (req.headers["user-agent"] || "").slice(0, 120)
      }),
      output: result
    });

  } catch (error) {

    console.error("LOCATION INGEST LOGGING FAILED:", error.message);

  }


  // Overland retries anything that isn't this exact acknowledgement, which is
  // what makes it safe for the phone to queue points while offline. Even on a
  // failure below, returning "ok" would silently drop the batch — so an error
  // deliberately returns a non-ok body and lets the phone hold onto them.
  if (failure) {
    return res.status(500).json({ error: failure.message });
  }

  return res.status(200).json({ result: "ok", ...result });

}


async function push(req, res) {

  if (req.method === "GET") {
    return res.status(200).json({ publicKey: publicKey() });
  }

  const { subscription } = req.body || {};

  await saveSubscription(subscription, req.headers["user-agent"] || null);

  return res.status(200).json({ success: true });

}


const HANDLERS = { location, push };


export default async function handler(req, res) {

  const kind = req.query.kind;

  // Overland has no way to send a custom header — it just POSTs to whatever
  // URL you give it. So location ingest also accepts a token in the query
  // string, which is normally the wrong place for a credential: query strings
  // end up in server logs and referrers.
  //
  // The mitigation is that this is a DIFFERENT secret from API_SECRET and is
  // accepted on this path only. If it leaks from a log it lets someone insert
  // fake GPS points, or read back how many points exist — bad, but bounded —
  // rather than read the profile, finances and deep-thinking history that
  // API_SECRET protects.
  const scopedKey = process.env.LOCATION_INGEST_KEY;

  const viaScopedKey =
    kind === "location" &&
    scopedKey &&
    req.query.key === scopedKey;

  if (!viaScopedKey && !requireAuth(req, res)) return;

  const run = HANDLERS[kind];

  if (!run) {
    return res.status(404).json({ error: `Unknown ingest kind: ${req.query.kind}` });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    return await run(req, res);

  } catch (error) {

    console.error(`INGEST ${req.query.kind} FAILED:`, error.message);

    return res.status(500).json({ error: error.message });

  }

}
