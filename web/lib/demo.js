// The private showcase session, defined in exactly one place.
//
// The owner unlocks /showcase with the real site passphrase. That route sets a
// derived session cookie instead of the owner cookie. The proxy admits it to
// every page; backend.js is where it changes meaning — a showcase session is
// answered ENTIRELY from app/fixtures.js, the same fictional dashboard the
// design preview uses, and every write is refused server-side.
//
// Two rules this must never drift from:
//
//   1. A showcase session never reads a real row. The fixtures are the answer to
//      every GET, and a path the fixtures don't cover returns an empty showcase
//      response rather than falling through to Supabase — falling through
//      would hand a stranger the real bank feed one uncovered path at a time.
//
//   2. Read-only is enforced where the write happens, not where the button
//      is. Hiding buttons is decoration; backendPost refusing the session is
//      the guarantee.
//
// The cookie is derived from SITE_PASSPHRASE so it cannot be forged from a
// public constant. It is deliberately not equal to the owner cookie: even a
// showcase session that reaches the wrong branch remains fixtures-only.
//
// This module stays pure: proxy.js imports it on the edge runtime, which cannot
// load the request-header helpers server components use.

export const SHOWCASE_PREFIX = "showcase:";

export function showcaseSession(passphrase) {
  return passphrase ? `${SHOWCASE_PREFIX}${passphrase}` : null;
}
