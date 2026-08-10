// The demo session, defined in exactly one place.
//
// "demo" typed into the login box (or the button on /welcome) sets the session
// cookie to this value instead of the real passphrase. The proxy admits it to
// every page; backend.js is where it changes meaning — a demo session is
// answered ENTIRELY from app/fixtures.js, the same fictional dashboard the
// design preview uses, and every write is refused server-side.
//
// Two rules this must never drift from:
//
//   1. A demo session never reads a real row. The fixtures are the answer to
//      every GET, and a path the fixtures don't cover returns an empty demo
//      response rather than falling through to Supabase — falling through
//      would hand a stranger the real bank feed one uncovered path at a time.
//
//   2. Read-only is enforced where the write happens, not where the button
//      is. Hiding buttons is decoration; backendPost refusing the session is
//      the guarantee.
//
// The value being public and guessable is the point — it is an invitation,
// not a credential. What it must never be is equal to SITE_PASSPHRASE, which
// login prevents by checking the real passphrase first.
//
// This module stays a bare constant: proxy.js imports it on the edge runtime,
// which cannot load the request-header helpers server components use.

export const DEMO_SESSION = "demo";
