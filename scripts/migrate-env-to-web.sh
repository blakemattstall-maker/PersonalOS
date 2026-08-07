#!/usr/bin/env bash
#
# Copies the backend's environment onto the web Vercel project.
#
#   bash scripts/migrate-env-to-web.sh
#
# Run this ONCE, before merging the fold branch. Until it runs, the web project
# has no Supabase, OpenAI, Google or push credentials, so a deployed build would
# come up with an empty dashboard and every API route failing.
#
# It reads values from .env.local, which is gitignored and already holds
# everything except the two Vercel marks as sensitive. It is idempotent in the
# sense that re-running it just overwrites with the same values.
#
# Nothing here touches the personal-os project. That one keeps its environment
# until you are satisfied the fold works, so rolling back is only ever a
# `git revert` plus a redeploy.

set -euo pipefail

cd "$(dirname "$0")/../web"

VARS=(
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  OPENAI_API_KEY
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REDIRECT_URI
  CRON_SECRET
  CANVAS_ICS_URL
  SIMPLEFIN_ACCESS_URL
  VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY
  VAPID_SUBJECT
  LOCATION_INGEST_KEY
)

echo "Copying ${#VARS[@]} variables from .env.local onto the web project."
echo

for name in "${VARS[@]}"; do

  value="$(grep -E "^${name}=" ../.env.local | head -1 | cut -d= -f2- || true)"

  if [ -z "$value" ]; then
    echo "  SKIP  $name — not found in .env.local"
    continue
  fi

  # Remove first so a re-run updates rather than erroring on a duplicate.
  npx vercel env rm "$name" production --yes >/dev/null 2>&1 || true

  printf '%s' "$value" | npx vercel env add "$name" production >/dev/null

  echo "  set   $name"

done

cat <<'NOTE'

Done — with two exceptions you have to handle yourself, because Vercel marks
them sensitive and will not reveal them to any CLI:

  API_SECRET
      The shared secret the iOS Shortcut sends as x-pos-key. The web project
      needs the SAME value the Shortcut already sends, because the forwarding
      rewrite passes the header straight through.

      If you still know the value:  npx vercel env add API_SECRET production
      If you do not: leave it unset for now. lib/auth.js is deliberately
      dormant when unset, so everything keeps working and the API is simply
      unauthenticated in the meantime — the same state it shipped in for its
      first four days. Set a fresh value on the web project and update the
      Shortcut's header in one sitting when convenient.

  SITE_PASSPHRASE
      Already set on the web project. Nothing to do.

And one variable you can now DELETE from the web project:

  BACKEND_KEY
      It existed so the dashboard could authenticate to a separate API over
      HTTP. There is no HTTP hop any more, so nothing reads it.

NOTE
