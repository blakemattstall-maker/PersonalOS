// Single place the dashboard talks to the API through.
//
// The backend's auth check is dormant until API_SECRET is set on it. This
// sends the matching header whenever BACKEND_KEY is set here, so the two can
// be switched on independently and in either order without an outage: no key
// set means no header sent and the backend waves it through, exactly as
// before.

const BACKEND_URL = () => process.env.BACKEND_URL;


function headers(extra = {}) {

  const key = process.env.BACKEND_KEY;

  return {
    ...extra,
    ...(key ? { "x-pos-key": key } : {})
  };

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

  const res = await fetch(`${BACKEND_URL()}${path}`, {
    cache: "no-store",
    headers: headers()
  });

  return res.json();

}


export async function backendPost(path, body) {

  const res = await fetch(`${BACKEND_URL()}${path}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });

  return res.json();

}
