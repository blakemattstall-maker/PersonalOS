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

  if (!requireAuth(req, res)) return;

  const run = HANDLERS[req.query.kind];

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
