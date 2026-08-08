import resourceHandler from "./api/[resource]/handler.js";
import ingestHandler from "./api/ingest/[kind]/handler.js";


// The dashboard's data layer. It no longer speaks HTTP.
//
// This used to `fetch()` a completely separate Vercel project on every call.
// The home page alone makes six of them, and each one paid a full round trip
// plus that project's own invocation overhead — which is where the 4-5 second
// page changes came from, not from the Supabase queries underneath, which
// measured under 150ms.
//
// Now the API handler lives in this same deployment, so the same code runs as
// a direct function call: no network, no second cold start, no serialisation.
// Every page keeps calling backendGet exactly as before — the eleven callers
// were deliberately not touched, because the point of this shape is that the
// hop disappears without the pages having to know it ever existed.
//
// The HTTP routes still exist under app/api and still run this same handler.
// They are for callers that genuinely are remote: the iOS Shortcut, Overland,
// Vercel Cron and Google's OAuth redirect.


// Turns "/api/data?prompts=1" into the { resource, query } the handler expects.
function parsePath(path) {

  const [rawPath, rawQuery = ""] = String(path).replace(/^\/api\//, "").split("?");

  // "brief/latest" is the one two-segment path. It maps onto the brief resource,
  // exactly as the old vercel.json rewrite did.
  const resource = rawPath.split("/")[0];

  const query = Object.fromEntries(new URLSearchParams(rawQuery).entries());

  if (rawPath === "brief/latest") query.peek = query.peek ?? "true";

  // The handler reads the resource off req.query, because over HTTP it arrives
  // as the [resource] path segment and Next merges route params into the same
  // object. In-process there is no router doing that merge, so it has to happen
  // here — without it every dashboard call returns "Unknown resource: undefined"
  // while the HTTP routes keep working, which is a difference no test that
  // exercised only the routes would ever have caught.
  query.resource = resource;

  // `/api/ingest/*` is a different function with a different dynamic segment,
  // and it was unreachable from here.
  //
  // parsePath only ever produced a `resource`, so backendPost("/api/ingest/push")
  // asked the [resource] handler for a resource called "ingest", which does not
  // exist — every attempt to register for notifications came back
  // {"error":"Unknown resource: ingest"}. Nothing surfaced it because
  // PushSetup.js discarded the result, so the settings page reported "On" while
  // the subscription had never been written and no push could ever be delivered.
  // The HTTP route worked the whole time, which is why this survived the
  // consolidation: only the in-process caller was broken.
  if (resource === "ingest") query.kind = rawPath.split("/")[1];

  return { resource, query };

}


// The two functions the dashboard can call. Anything else under app/api —
// capture, tts, cron, the OAuth callback — is reached only by a remote caller
// that genuinely does speak HTTP, so it deliberately has no entry here.
const HANDLERS = { ingest: ingestHandler };

function handlerFor(resource) {
  return HANDLERS[resource] || resourceHandler;
}


// The one thing removing the HTTP hop silently changed, put back.
//
// `res.json()` used to mean "serialise this and send it", so every value a
// handler returned reached a page as JSON had left it: a Date became an ISO
// string, an undefined key vanished, a class instance became a plain object.
// Calling the handler directly skips all of that and hands the page the live
// object graph instead — which is how the finance handler's `recent` list,
// carrying real Date objects out of lib/simplefin.js, took the whole money page
// down with "Objects are not valid as a React child". It had rendered a raw ISO
// string for as long as the hop existed, so the bug looked cosmetic right up to
// the moment it wasn't.
//
// Fixing only that one field would leave the trap armed for the next handler
// that returns something JSON would have flattened. This is one round trip per
// call — microseconds against the Supabase and OpenAI work underneath it — and
// it makes the in-process path provably identical to the HTTP one rather than
// merely intended to be.
function asJson(payload) {
  if (payload === undefined || payload === null) return payload;
  return JSON.parse(JSON.stringify(payload));
}


// Invokes the handler with the minimal req/res it actually uses, and returns
// the parsed JSON body — the same shape the old fetch().json() produced, so
// callers cannot tell the difference.
async function invoke({ method, path, body = undefined }) {

  const { resource, query } = parsePath(path);

  return await new Promise((resolve, reject) => {

    let statusCode = 200;

    let settled = false;

    const res = {
      status(code) { statusCode = code; return res; },
      setHeader() { return res; },
      json(payload) {
        if (settled) return res;
        settled = true;
        // A handler error still resolves rather than throwing: every caller in
        // this app already has a try/catch that falls back to an empty state,
        // and they were written against a fetch that resolved on a 500 too.
        resolve(asJson(statusCode >= 400 && payload && !("error" in payload)
          ? { ...payload, error: `Request failed with ${statusCode}` }
          : payload));
        return res;
      },
      send(payload) { return res.json(payload); },
      end() {
        if (settled) return res;
        settled = true;
        resolve({});
        return res;
      },
      redirect() { return res; }
    };

    // The handler still runs requireAuth, and it should — this is the same
    // code path the Shortcut hits, and weakening it for one caller is how an
    // auth check quietly stops being one. So the in-process call presents the
    // same credential a remote one would. Without this, every dashboard page
    // would 401 the moment API_SECRET is set, which it already is in
    // production, and the failure would look like an empty dashboard rather
    // than an auth error.
    const headers = process.env.API_SECRET ? { "x-pos-key": process.env.API_SECRET } : {};

    Promise.resolve(
      handlerFor(resource)({ method, query, body, headers, url: path }, res)
    ).catch(reject);

  });

}


export async function backendGet(path) {

  // Local design fixtures. POS_FIXTURES is set only by the `web-preview` entry
  // in .claude/launch.json — never in .env.local and never in Vercel — so this
  // branch is dead code in every deployed build. See fixtures.js.
  if (process.env.POS_FIXTURES === "1") {

    const { fixtureFor } = await import("./fixtures.js");

    const canned = fixtureFor(path);

    if (canned) return canned;

  }

  return invoke({ method: "GET", path });

}


export async function backendPost(path, body) {

  return invoke({ method: "POST", path, body });

}
