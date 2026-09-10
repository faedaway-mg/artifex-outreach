#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-production.sh — the ONE controlled way to ship Artifex Outreach.
# Replaces informal `railway up`. Fails closed at every gate.
#
#   pnpm deploy:production                 # full gated deploy
#   pnpm deploy:production --apply-migrations   # also apply pending DB migrations first
#   pnpm deploy:production --skip-build         # reuse checks already run this session (rare)
#
# Never prints secrets (password, DATABASE_URL, cookies).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

APPLY_MIGRATIONS=0
SKIP_BUILD=0
for a in "$@"; do
  case "$a" in
    --apply-migrations) APPLY_MIGRATIONS=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "Unknown flag: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# 1 ── Railway target (fail-closed) ───────────────────────────────────────────
step "Verifying Railway target (must be artifex-outreach / production / outreach-web)"
bash "$ROOT/scripts/railway-guard.sh" || fail "Railway target verification failed."

# 2 ── Git state + intended SHA ───────────────────────────────────────────────
step "Git state"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "  Working tree has uncommitted changes:"
  git status --short | sed 's/^/    /'
  if [ "${ALLOW_DIRTY:-0}" = "1" ]; then
    echo "  ⚠ ALLOW_DIRTY=1 — proceeding, but runtime provenance will NOT match $SHORT."
  else
    fail "Refusing to deploy an uncommitted working tree — commit + push first so the deployed image maps to an exact commit (set ALLOW_DIRTY=1 only for a deliberate throwaway deploy)."
  fi
else
  echo "  ✓ Working tree clean."
fi
echo "  Branch: $BRANCH   SHA: $SHA"

# 3 ── Quality gates ──────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" -eq 0 ]; then
  step "typecheck"; pnpm -s typecheck || fail "typecheck failed."
  step "lint";      pnpm -s lint      || fail "lint failed."
  step "tests";     pnpm -s test      || fail "tests failed."
  step "production build"; pnpm -s build || fail "build failed."
else
  echo "  (--skip-build) skipping typecheck/lint/test/build"
fi

# 3.5 ── Breakbot rendered-browser visual regression (Part Q/T/AD) ──────────────
# Launches headless Chromium over the deterministic layout fixtures at mobile
# (390×844) + desktop (1440×900) and fails closed if a fixture that must render
# cleanly is BLOCKED or a deliberately-broken fixture stops being caught (overflow,
# price-in-hero, sticky-overlap). Requires a local Chromium (Playwright); if the
# browser genuinely cannot launch, this fails closed rather than silently passing.
# Runs FIRST so the release-preflight orchestrator (3.6) ingests a fresh verdict.
step "Breakbot rendered visual regression (mobile + desktop fixtures)"
pnpm -s tsx "$ROOT/scripts/breakbot-visual.ts" \
  || fail "Breakbot visual regression failed — a rendered layout check regressed (or Chromium could not launch). Holding the deploy."

# 3.6 ── Breakbot RELEASE-PREFLIGHT — the canonical release gate (mandate §1/§20/§31) ──
# The FINAL AUTHORITY on whether this candidate may deploy. Composes every sub-suite into
# one Release Readiness Report: regression (golden+failure fixtures) · business invariants ·
# media TIMELINE QA over every required explainer master (samples the whole runtime — the
# blank-after-opening class) · explainer coverage · escaped-defect registry · the ingested
# visual verdict. Fail-closed: any gating suite BLOCKED holds the deploy. A deploy must not
# happen merely because tests compiled.
#
# EMERGENCY BYPASS (§1): only via an explicit, exceptional operator action that leaves an
# audit record. Never bypassed by default.
if [ "${BREAKBOT_BYPASS:-0}" = "1" ]; then
  mkdir -p "$ROOT/artifacts/breakbot-release"
  printf '{"bypass":true,"sha":"%s","branch":"%s","at":"%s","actor":"%s"}\n' \
    "$SHA" "$BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${USER:-unknown}" \
    >> "$ROOT/artifacts/breakbot-release/bypass-audit.jsonl"
  printf '\033[31m  ⚠ BREAKBOT_BYPASS=1 — release gate SKIPPED by explicit operator action. Audit recorded to artifacts/breakbot-release/bypass-audit.jsonl. This is exceptional; the release is NOT Breakbot-verified.\033[0m\n'
else
  step "Breakbot release-preflight (canonical release gate)"
  pnpm -s tsx "$ROOT/scripts/breakbot-release-preflight.ts" \
    || fail "Breakbot release-preflight BLOCKED the deploy — the release candidate is not usable. Read the Release Readiness Report above; fix the blockers (or, only for a genuine emergency, re-run with BREAKBOT_BYPASS=1 to record an audited bypass)."
fi

# 4 ── Pending DB migrations ──────────────────────────────────────────────────
step "Checking pending database migrations"
PENDING="$(node "$ROOT/scripts/migration-status.mjs" --count 2>/dev/null || echo "ERR")"
if [ "$PENDING" = "ERR" ]; then
  echo "  ⚠ Could not determine migration status (no DB access from here). Ensure migrations are applied."
elif [ "$PENDING" -gt 0 ]; then
  if [ "$APPLY_MIGRATIONS" -eq 1 ]; then
    echo "  $PENDING pending — applying now (pnpm db:migrate)"
    pnpm -s db:migrate || fail "migration apply failed."
    node "$ROOT/scripts/migration-status.mjs" --count | grep -qx 0 || fail "migrations still pending after apply."
    # Refresh the count the preflight consumes. Without this the stale pre-apply
    # value reaches PREFLIGHT_MIGRATIONS_RESULT and the preflight blocks a deploy
    # whose migrations we just verified as applied — --apply-migrations could
    # never succeed. The re-check above is what proves 0 is honest here.
    PENDING=0
    echo "  ✓ migrations applied."
  else
    fail "$PENDING migration(s) pending. Re-run with --apply-migrations (or run 'pnpm db:migrate') before deploying."
  fi
else
  echo "  ✓ No pending migrations."
fi

# 4.5 ── Read-only Railway preflight ──────────────────────────────────────────
# Last stop before the first mutating command. Collects read-only signals
# (deployment visibility, official public status, current app health) and writes a
# redacted evidence artifact under artifacts/deploy-preflight/. Fails closed ONLY on
# a confirmed official deploy-blocking incident; UNKNOWN states warn loudly but are
# never converted to PASS. Full policy: scripts/deploy-preflight.sh.
step "Read-only Railway preflight"
PREFLIGHT_MIGRATIONS_RESULT="$PENDING" bash "$ROOT/scripts/deploy-preflight.sh" || fail "Preflight blocked the deployment."

# 4.6 ── Pin runtime provenance to THIS commit ───────────────────────────────
# The health route reports process.env.APP_VERSION as the deployed commit. Set it to
# the exact SHA being deployed so /api/health proves "production == this commit". Uses
# ONLY `--set` (never bare `railway variables`, which would print secrets).
step "Pinning APP_VERSION to $SHORT"
railway variables --service outreach-web --set "APP_VERSION=$SHA" --skip-deploys >/dev/null 2>&1 \
  && echo "  ✓ APP_VERSION set to $SHA" \
  || echo "  ⚠ could not set APP_VERSION (continuing) — verify /api/health SHA after deploy"

# 5 ── Deploy ─────────────────────────────────────────────────────────────────
step "Deploying to outreach-web (railway up)"
railway up --service outreach-web --ci

# 6 ── Confirm deployment + capture ID/timestamp ──────────────────────────────
step "Confirming deployment"
DEPLOY_LINE="$(railway deployment list 2>/dev/null | awk 'NR>1 && /SUCCESS/ {print; exit}')"
DEPLOY_ID="$(printf '%s' "$DEPLOY_LINE" | awk '{print $1}')"
DEPLOY_TS="$(printf '%s' "$DEPLOY_LINE" | sed -E 's/^[^|]*\|[^|]*\|[[:space:]]*//')"
echo "  Deployment: ${DEPLOY_ID:-unknown}  ($DEPLOY_TS)"

# 7 ── Smoke test (no secrets printed) ────────────────────────────────────────
step "Smoke test against production"
BASE="https://outreach.artifexlabs.tech"
PASS=1

HEALTH="$(curl -s -m 25 "$BASE/api/health" || true)"
echo "$HEALTH" | grep -q '"status":"ok"'        && echo "  ✓ /api/health status ok"       || { echo "  ✗ /api/health not ok"; PASS=0; }
echo "$HEALTH" | grep -q '"connected":true'     && echo "  ✓ database connected"           || { echo "  ✗ database not connected"; PASS=0; }
# Provenance: runtime commit MUST equal the deployed SHA (deterministic source proof).
echo "$HEALTH" | grep -q "\"commit\":\"$SHA\""   && echo "  ✓ /api/health SHA == $SHORT"     || { echo "  ✗ /api/health SHA != $SHORT (runtime provenance mismatch)"; PASS=0; }

LOGIN_CODE="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$BASE/login" || true)"
[ "$LOGIN_CODE" = "200" ] && echo "  ✓ /login reachable (200)" || { echo "  ✗ /login returned $LOGIN_CODE"; PASS=0; }

# Authenticated surfaces — fetch password to a 0600 temp file, never print it.
umask 077; OPFILE="$(mktemp)"; COOKIES="$(mktemp)"
trap 'rm -f "$OPFILE" "$COOKIES"' EXIT
railway variables --service outreach-web --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write((JSON.parse(s).OUTREACH_PASSWORD)||""))' > "$OPFILE" || true

if [ -s "$OPFILE" ]; then
  curl -s -m 25 -c "$COOKIES" -o /dev/null --data-urlencode "password@$OPFILE" --data "from=/" "$BASE/api/auth/login" || true
  IDS="$(node "$ROOT/scripts/migration-status.mjs" --sample-ids 2>/dev/null || true)"   # "leadId deliverableId"
  LEAD_ID="$(printf '%s' "$IDS" | awk '{print $1}')"; DELIV_ID="$(printf '%s' "$IDS" | awk '{print $2}')"
  if [ -n "$LEAD_ID" ]; then
    c1="$(curl -s -m 25 -b "$COOKIES" -o /dev/null -w '%{http_code}' "$BASE/leads/$LEAD_ID")"
    c2="$(curl -s -m 25 -b "$COOKIES" -o /dev/null -w '%{http_code}' "$BASE/conversation/$LEAD_ID")"
    [ "$c1" = "200" ] && echo "  ✓ authenticated lead page (200)"         || { echo "  ✗ lead page $c1"; PASS=0; }
    [ "$c2" = "200" ] && echo "  ✓ authenticated conversation page (200)" || { echo "  ✗ conversation page $c2"; PASS=0; }
  fi
  if [ -n "$DELIV_ID" ]; then
    ct="$(curl -s -m 40 -b "$COOKIES" -o /dev/null -w '%{content_type}' "$BASE/api/deliverable/$DELIV_ID/pdf")"
    case "$ct" in application/pdf*) echo "  ✓ authenticated PDF route (application/pdf)";; *) echo "  ✗ PDF route content-type: $ct"; PASS=0;; esac
  fi
  # Launch Readiness gate (GO / NO-GO) — must be reachable + return a state. This diagnostic
  # never sends anything; we assert it resolves a state, not that state == GO (env-dependent).
  LR="$(curl -s -m 25 -b "$COOKIES" "$BASE/api/launch-readiness" || true)"
  echo "$LR" | grep -qE '"state":"(GO|NO-GO)"' && echo "  ✓ launch-readiness gate resolves ($(echo "$LR" | grep -oE '"state":"(GO|NO-GO)"' | head -1))" || { echo "  ✗ launch-readiness gate did not resolve a state"; PASS=0; }
else
  echo "  ⚠ Could not load OUTREACH_PASSWORD; skipped authenticated smoke checks."
fi

# 8 ── Summary ────────────────────────────────────────────────────────────────
step "Deploy summary"
echo "  Local SHA:        $SHA ($SHORT, $BRANCH)"
echo "  Deployment ID:    ${DEPLOY_ID:-unknown}"
echo "  Deployment time:  $DEPLOY_TS"
echo "  Smoke test:       $([ "$PASS" -eq 1 ] && echo PASS || echo FAIL)"
[ "$PASS" -eq 1 ] || fail "Smoke test failed — investigate before declaring the deploy good."
echo "  ✓ Production deploy complete and smoke-tested."
