#!/usr/bin/env bash
#
# One-time git history rewrite.
#
# Replaces commits authored/committed with a bogus local git email
# (e.g. user@hostname.local, auto-generated when user.email is unset) with
# your real, Vercel-connected identity. This is what unblocks Vercel deploys
# that fail with "attempted to deploy ... but they're not a member of the team".
#
# DESTRUCTIVE: rewrites every commit hash on all branches and tags.
# After running you MUST force-push:  git push --force-with-lease origin main
#
# Override the defaults inline if needed, e.g.:
#   OLD_EMAIL="bad@host.local" CORRECT_EMAIL="me@example.com" ./scripts/reauthor-history.sh
#
set -euo pipefail

OLD_EMAIL="${OLD_EMAIL:-uditkhandelwal@Udits-Mac-mini.local}"
CORRECT_NAME="${CORRECT_NAME:-Udit Khandelwal}"
CORRECT_EMAIL="${CORRECT_EMAIL:-uditk2@gmail.com}"

echo "Rewriting commits by <$OLD_EMAIL>"
echo "                 ->  $CORRECT_NAME <$CORRECT_EMAIL>"
echo

export OLD_EMAIL CORRECT_NAME CORRECT_EMAIL
export FILTER_BRANCH_SQUELCH_WARNING=1

git filter-branch -f --env-filter '
if [ "$GIT_COMMITTER_EMAIL" = "$OLD_EMAIL" ]; then
    export GIT_COMMITTER_NAME="$CORRECT_NAME"
    export GIT_COMMITTER_EMAIL="$CORRECT_EMAIL"
fi
if [ "$GIT_AUTHOR_EMAIL" = "$OLD_EMAIL" ]; then
    export GIT_AUTHOR_NAME="$CORRECT_NAME"
    export GIT_AUTHOR_EMAIL="$CORRECT_EMAIL"
fi
' --tag-name-filter cat -- --branches --tags

echo
echo "Rewritten history:"
git log --pretty='  %h  %an <%ae>'
echo
echo "Next step (history hashes changed, remote must be updated):"
echo "  git push --force-with-lease origin main"
