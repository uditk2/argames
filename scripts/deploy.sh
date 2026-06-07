#!/usr/bin/env bash
#
# Local production deploy for Demon Realm.
#
# Includes an idempotent "author guard": before deploying it makes sure the
# commit being shipped is authored with your Vercel-connected email. If not,
# it re-authors just that one HEAD commit. This prevents Vercel from BLOCKing
# the deploy with "... they're not a member of the team".
#
# Usage:
#   export VERCEL_TOKEN=xxxxxxxx
#   ./scripts/deploy.sh
#
set -euo pipefail

CORRECT_NAME="${CORRECT_NAME:-Udit Khandelwal}"
CORRECT_EMAIL="${CORRECT_EMAIL:-uditk2@gmail.com}"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "VERCEL_TOKEN is not set. Run:  export VERCEL_TOKEN=xxxx" >&2
  exit 1
fi

# Always commit with the Vercel-connected identity in this repo.
git config user.name  "$CORRECT_NAME"
git config user.email "$CORRECT_EMAIL"

# Guard: re-author the HEAD commit if its email won't be accepted by Vercel.
HEAD_EMAIL="$(git log -1 --pretty='%ae')"
if [ "$HEAD_EMAIL" != "$CORRECT_EMAIL" ]; then
  echo "HEAD author <$HEAD_EMAIL> != <$CORRECT_EMAIL> — re-authoring HEAD commit."
  git commit --amend --no-edit --author="$CORRECT_NAME <$CORRECT_EMAIL>"
  echo "Note: HEAD hash changed; run 'git push --force-with-lease origin main' to sync the remote."
fi

echo "Deploying commit: $(git log -1 --pretty='%h by %ae')"

vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
URL="$(vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN")"
echo "Production URL: $URL"
