#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# railway-guard.sh — fail-closed verification that this directory is linked to
# the correct Artifex production target before ANY Railway operation.
#
# Refuses to proceed unless:
#   • RAILWAY_TOKEN is NOT set (a global token overrides directory links and can
#     silently retarget another project — this is what nearly deployed to ashmap)
#   • linked project     == artifex-outreach
#   • linked environment == production
#   • linked service     == outreach-web
#
# Exits 0 only when all match. Used by `pnpm railway:verify` and deploy-production.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EXPECTED_PROJECT="artifex-outreach"
EXPECTED_ENV="production"
EXPECTED_SERVICE="outreach-web"

fail() { echo "✗ $1" >&2; exit 1; }

if [ -n "${RAILWAY_TOKEN:-}" ]; then
  fail "RAILWAY_TOKEN is set in the environment. It overrides the per-directory
    project link and can silently target the WRONG Railway project. Unset it:
        unset RAILWAY_TOKEN
    (It has also been disabled in ~/.zshrc; open a new terminal to clear it.)"
fi

command -v railway >/dev/null 2>&1 || fail "railway CLI not found on PATH."

WHO="$(railway whoami 2>&1 || true)"
case "$WHO" in
  *Unauthorized*|*"not logged"*|*error*) fail "Not logged in to Railway. Run: railway login" ;;
esac

STATUS="$(railway status 2>/dev/null || true)"
[ -n "$STATUS" ] || fail "No linked Railway project in $(pwd). Run: railway link"

trim() { printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'; }
PROJECT="$(trim "$(printf '%s\n' "$STATUS" | awk -F':' '/^Project:/{sub(/^[^:]*:/,"");print;exit}')")"
ENVIRON="$(trim "$(printf '%s\n' "$STATUS" | awk -F':' '/^Environment:/{sub(/^[^:]*:/,"");print;exit}')")"
SERVICE="$(trim "$(printf '%s\n' "$STATUS" | awk '/Linked service/{f=1;next} f&&NF{print;exit}')")"

[ "$PROJECT" = "$EXPECTED_PROJECT" ] || fail "Linked project is '$PROJECT', expected '$EXPECTED_PROJECT'. Run: railway link"
[ "$ENVIRON" = "$EXPECTED_ENV" ]     || fail "Linked environment is '$ENVIRON', expected '$EXPECTED_ENV'."
[ "$SERVICE" = "$EXPECTED_SERVICE" ] || fail "Linked service is '$SERVICE', expected '$EXPECTED_SERVICE'. Run: railway service"

echo "✓ Railway target verified: project=$PROJECT env=$ENVIRON service=$SERVICE"
