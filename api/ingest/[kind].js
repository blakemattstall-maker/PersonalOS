import { requireAuth } from "../../lib/auth.js";
import { ingestLocationPoints, parseOverlandPayload } from "../../tools/location.js";
import { saveSubscription, publicKey } from "../../lib/push.js";


// One function for everything that pushes data INTO the system, rather than one
// per source. Vercel Hobby allows 12 serverless functions and this project runs
// close to that ceiling, so a dynamic segment keeps location ingest, push
// registration and the VAPID key handout at a single function.


async function location(req, res) {

  // Overland batches points as a GeoJSON FeatureCollection; a plain array is
  // accepted too so the endpoint can be driven from a Shortcut or curl.
  const points = Array.isArray(req.body)
    ? req.body
    : parseOverlandPayload(req.body);

  const result = await ingestLocationPoints(points);

  // Overland retries anything that isn't this exact acknowledgement, which is
  // what makes it safe for the phone to queue points while offline.
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
  // fake GPS points — bad, but bounded — rather than read the profile,
  // finances and deep-thinking history that API_SECRET protects.
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
