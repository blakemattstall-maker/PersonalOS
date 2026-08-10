// Per-instance rate limiting, honest about what it is.
//
// Discovered the hard way: /api/tts answered 200 to a request carrying no
// cookie and no key — anyone on the internet could burn OpenAI tokens on the
// project's bill. Auth fixes that specific hole (the TTS route now demands a
// session), but auth alone leaves two doors open: a LEAKED credential can
// spend without ceiling, and the demo session is deliberately public. This is
// the ceiling.
//
// It is a fixed window in module-scope memory, which on serverless means
// per-warm-instance: counts reset on cold start and are not shared between
// concurrent instances. That is a real limitation and it is the right trade
// anyway — the alternative is a Redis/KV dependency for an app whose entire
// hosting bill is $0, to defend against an attacker sophisticated enough to
// spray requests across instances but somehow in possession of nothing better
// to do. What this DOES stop is the realistic failure: a script hammering one
// endpoint from one place, a stolen key in a loop, a demo visitor with
// curiosity and a for-loop. Auth is the lock; this is the chain on the door.
//
// Never applied to the cron routes: they carry CRON_SECRET, are invoked by
// Vercel itself, and throttling a scheduled job creates exactly the silent
// skipped-run failure the whole system is built to avoid.

const WINDOW_MS = 60_000;

// key -> { count, resetAt }
const buckets = new Map();

// The map grows one entry per (route, caller) pair and would grow forever on
// a long-lived instance being scanned by bots. Swept lazily — no timer to
// leak — whenever it gets big.
const SWEEP_AT = 5000;

function sweep(now) {
  if (buckets.size < SWEEP_AT) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}


// The core decision, pure enough to test: may `key` act again now?
export function rateLimit(key, limit, { now = Date.now() } = {}) {

  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;

  return { ok: true, remaining: limit - bucket.count };

}


// Who is calling. On Vercel the client's address is the first entry of
// x-forwarded-for. The in-process path (backend.js) constructs requests with
// no such header, so the dashboard's own server-side calls share one "local"
// bucket — which is fine, because the only real session is the owner's, and
// demo reads never reach a handler at all (they are answered from fixtures
// before invoke()).
export function clientIp(req) {

  const forwarded = req.headers?.["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return "local";

}


// Pages-style guard, shaped like requireAuth: true means proceed, false means
// the 429 has already been sent.
export function enforceLimit(req, res, { name, limit }) {

  const result = rateLimit(`${name}:${clientIp(req)}`, limit);

  if (result.ok) return true;

  res.setHeader("Retry-After", String(result.retryAfter));
  res.status(429).json({ error: "Too many requests — slow down.", retryAfter: result.retryAfter });

  return false;

}


// Exported for the tests only — a limiter whose state cannot be reset cannot
// be tested without ordering side effects between cases.
export function resetLimits() {
  buckets.clear();
}
