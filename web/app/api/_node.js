// Runs the existing Node-style API handlers inside Next.js route handlers.
//
// The five handlers in this app are the spine of the whole system — capture,
// the dashboard's read/write surface, the cron jobs, GPS ingest and the Google
// OAuth dance — and between them they are about 1,450 lines that have been
// debugged against real data for a week. Rewriting all of that by hand into
// Request/Response style would have meant touching every branch of every one of
// them, and the bugs would have been in the parts nobody thought to re-test.
//
// So the handlers are not rewritten. This adapter presents them the `(req, res)`
// they already expect, and the only genuinely new code is right here, in one
// file, exercised by every route and covered by tests/api-routes.test.js.
//
// It is deliberately a small surface: exactly the pieces of Express-ish `req`
// and `res` that these five files actually use, and nothing else. Anything they
// don't call is absent on purpose rather than stubbed, so a handler reaching for
// something unsupported fails loudly in a test instead of silently at runtime.


function headersToObject(headers) {

  const out = {};

  for (const [key, value] of headers.entries()) out[key.toLowerCase()] = value;

  return out;

}


async function readBody(request) {

  if (request.method === "GET" || request.method === "HEAD") return {};

  const type = request.headers.get("content-type") || "";

  try {

    if (type.includes("application/json")) return await request.json();

    if (type.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(await request.text()));
    }

    // Overland posts JSON without always announcing it, and the Shortcut's
    // behaviour depends on how the action was configured. Try JSON anyway
    // rather than dropping a body that is perfectly valid.
    const raw = await request.text();

    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }

  } catch {

    return {};

  }

}


export function nodeRoute(handler) {

  return async function route(request, context) {

    const url = new URL(request.url);

    // Route params (`[resource]`, `[job]`, `[kind]`, `[step]`) and query string
    // land in the same object, which is what the handlers already assume —
    // req.query.resource and req.query.peek are read the same way.
    const params = await (context?.params ?? Promise.resolve({}));

    const query = { ...Object.fromEntries(url.searchParams.entries()), ...params };

    const req = {
      method: request.method,
      url: request.url,
      headers: headersToObject(request.headers),
      query,
      body: await readBody(request)
    };


    return await new Promise((resolve) => {

      let statusCode = 200;

      const outHeaders = {};

      let settled = false;

      // A handler that responds twice would otherwise reject an already
      // resolved promise and surface as an unhandled rejection with no clue
      // where it came from.
      const finish = (response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };

      const res = {

        status(code) {
          statusCode = code;
          return res;
        },

        setHeader(name, value) {
          outHeaders[name] = value;
          return res;
        },

        json(payload) {
          finish(Response.json(payload, { status: statusCode, headers: outHeaders }));
          return res;
        },

        send(payload) {
          if (payload && typeof payload === "object") return res.json(payload);
          finish(new Response(String(payload ?? ""), { status: statusCode, headers: outHeaders }));
          return res;
        },

        redirect(codeOrUrl, maybeUrl) {
          const location = maybeUrl ?? codeOrUrl;
          const code = maybeUrl ? codeOrUrl : 307;
          finish(Response.redirect(new URL(location, url.origin), code));
          return res;
        },

        end(payload) {
          if (payload !== undefined) return res.send(payload);
          finish(new Response(null, { status: statusCode, headers: outHeaders }));
          return res;
        }

      };


      Promise.resolve(handler(req, res)).catch((error) => {

        console.error("ROUTE HANDLER THREW:", error?.message);

        finish(Response.json({ error: error?.message || "Handler failed" }, { status: 500 }));

      });

    });

  };

}
