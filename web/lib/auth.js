// Shared-secret auth for the data endpoints.
//
// Vercel's own Deployment Protection can't be used here: it redirects to an
// SSO login that an iOS Shortcut has no way to complete, which is exactly why
// it was turned off. So the check lives in application code, the same pattern
// the cron routes already use with CRON_SECRET.
//
// This is deliberately DORMANT until API_SECRET is set on the project. Turning
// auth on requires the Shortcut and the web frontend to start sending the
// header at the same moment, and the Shortcut can only be edited by hand on
// the phone — enforcing before that happens would take the whole system down.
// With the variable unset every request passes exactly as before; setting it
// switches enforcement on with no redeploy.
//
// Header only, never a query parameter: query strings end up in server logs,
// browser history and referrer headers, which is no place for a credential.

const HEADER = "x-pos-key";


export function authEnabled() {
  return Boolean(process.env.API_SECRET);
}


// Returns true when the request may proceed. When it returns false it has
// already sent the 401, so callers should simply return.
export function requireAuth(req, res) {

  const configured = process.env.API_SECRET;

  if (!configured) {
    return true;
  }

  const provided = req.headers[HEADER];

  if (provided && provided === configured) {
    return true;
  }

  res.status(401).json({ error: "Unauthorized" });

  return false;

}
