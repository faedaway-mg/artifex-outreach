#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-preflight.sh — READ-ONLY Railway preflight, run by deploy-production.sh
# after the target guard, quality gates, and the fail-closed migration check, and
# BEFORE the first mutating command (`railway up`).
#
# It answers exactly one question:
#   "Is there any known, trustworthy, read-only evidence that should block or
#    caution this deployment attempt?"
#
# A PASS means ONLY: nothing observed by these read-only checks currently blocks
# ATTEMPTING the deployment. It never claims Railway is available, the deploy will
# succeed, or that account/workspace restrictions don't exist (the public status
# page covers only significant, widespread incidents — it is not exhaustive).
#
# States: PASS · CAUTION · UNKNOWN · BLOCK   (precedence BLOCK > UNKNOWN > CAUTION > PASS)
# Policy (deliberate, smallest consistent with the existing fail-closed philosophy):
#   • BLOCK only when the official status page confirms an active incident that
#     explicitly pauses/blocks deployments. Not overridable.
#   • UNKNOWN (status page unreachable, deployment list unreadable, prod health
#     unreachable) → prominent warning + continue. Rationale: a status-page outage
#     does not prove Railway is down; a broken CLI will fail `railway up` safely on
#     its own; and deploying a fix OVER a broken production is an established,
#     legitimate workflow here (e.g. shipping a hotfix). UNKNOWN is preserved as
#     UNKNOWN in the summary + evidence artifact — it is never rewritten as PASS.
#   • Target identity and migrations stay fail-closed in deploy-production.sh and
#     are NOT overridable here; this script consumes their results.
# No override flags exist: nothing this script blocks on is overridable by design.
#
# READ-ONLY commands used: `railway deployment list` (documented informational),
# `railway --version`, and unauthenticated HTTPS GETs with bounded timeouts.
# Never run here: up/redeploy/restart/rollback/link/variable or any write.
#
# Evidence: a redacted JSON artifact per invocation under artifacts/deploy-preflight/
# (gitignored), written atomically (tmp + mv) so an interrupted run can't leave a
# complete-looking record.
#
# Test injection (used by automated tests; harmless in production):
#   RAILWAY_BIN · PREFLIGHT_STATUS_URL · PREFLIGHT_HEALTH_URL · PREFLIGHT_ARTIFACT_DIR
#   PREFLIGHT_MIGRATIONS_RESULT (passed by deploy-production.sh)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY_BIN="${RAILWAY_BIN:-railway}"
STATUS_URL="${PREFLIGHT_STATUS_URL:-https://status.railway.com}"
HEALTH_URL="${PREFLIGHT_HEALTH_URL:-https://outreach.artifexlabs.tech/api/health}"
ART_DIR="${PREFLIGHT_ARTIFACT_DIR:-artifacts/deploy-preflight}"
MIGRATIONS_RESULT="${PREFLIGHT_MIGRATIONS_RESULT:-not-provided}"
CURL_TIMEOUT=10

# Expected target (verified fail-closed by railway-guard.sh BEFORE this script runs;
# re-stated here for the evidence record, never re-derived or relaxed).
TARGET_PROJECT="artifex-outreach"; TARGET_ENV="production"; TARGET_SERVICE="outreach-web"

say()  { printf '  %s\n' "$1"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$1"; }

# Per-check results (bash-3 compatible: plain vars, no assoc arrays)
DEPLOY_STATE="UNKNOWN"; DEPLOY_REASON=""; DEPLOY_ID=""; DEPLOY_STATUS=""
STATUS_STATE="UNKNOWN"; STATUS_REASON=""
HEALTH_STATE="UNKNOWN"; HEALTH_REASON=""; HEALTH_HTTP=""
MIG_STATE="UNKNOWN";    MIG_REASON=""

# ── Check 2: current deployment visibility (read-only CLI) ────────────────────
check_deployments() {
  local out rc top
  set +e; out="$("$RAILWAY_BIN" deployment list 2>&1)"; rc=$?; set -e
  if [ $rc -ne 0 ] || [ -z "$out" ]; then
    DEPLOY_STATE="UNKNOWN"; DEPLOY_REASON="railway deployment list failed (rc=$rc)"; return 0
  fi
  # First data row: "  <id> | <STATUS> | <timestamp>" — parse structurally on '|'.
  top="$(printf '%s\n' "$out" | awk -F'|' 'NR>1 && NF>=2 {gsub(/^[ \t]+|[ \t]+$/,"",$1); gsub(/[ \t]/,"",$2); print $1"\t"$2; exit}')"
  if [ -z "$top" ]; then
    DEPLOY_STATE="UNKNOWN"; DEPLOY_REASON="deployment list output not interpretable"; return 0
  fi
  DEPLOY_ID="$(printf '%s' "$top" | cut -f1)"
  DEPLOY_STATUS="$(printf '%s' "$top" | cut -f2)"
  case "$DEPLOY_STATUS" in
    BUILDING|DEPLOYING|INITIALIZING|QUEUED|WAITING)
      DEPLOY_STATE="CAUTION"; DEPLOY_REASON="an in-progress deployment already exists ($DEPLOY_STATUS)";;
    SUCCESS|FAILED|CRASHED|REMOVED|COMPLETED)
      DEPLOY_STATE="PASS"; DEPLOY_REASON="latest deployment $DEPLOY_STATUS; no in-progress operation visible";;
    *)
      DEPLOY_STATE="UNKNOWN"; DEPLOY_REASON="unrecognized deployment status '$DEPLOY_STATUS'";;
  esac
}

# ── Check 3: official public status page (bounded, unauthenticated) ───────────
check_status_page() {
  local body rc
  set +e; body="$(curl -sL -m "$CURL_TIMEOUT" "$STATUS_URL" 2>/dev/null)"; rc=$?; set -e
  if [ $rc -ne 0 ] || [ -z "$body" ]; then
    STATUS_STATE="UNKNOWN"; STATUS_REASON="status source unreachable ($STATUS_URL)"; return 0
  fi
  # Normalize before matching (verified against the live page): visible text is split
  # by tags/comments (React text nodes), while script payloads embed HISTORICAL
  # incident wording. Strip script blocks, comments, and tags so we match the page's
  # visible text — not stale JSON history.
  body="$(printf '%s' "$body" | sed -e 's/<script[^>]*>[^<]*<\/script>//g' -e 's/<!--[^>]*-->//g' -e 's/<[^>]*>/ /g' | tr -s ' \n' '  ')"
  # ORDER MATTERS (verified against the live page): the page embeds HISTORICAL
  # incident data in script payloads, so incident wording alone is NOT evidence of an
  # ACTIVE incident. The current-state marker ("Fully Operational") is authoritative —
  # check it FIRST; incident patterns apply only when the all-clear marker is absent.
  if printf '%s' "$body" | grep -qi 'Fully Operational'; then
    STATUS_STATE="PASS"; STATUS_REASON="status page reports Fully Operational (page covers widespread incidents only)"; return 0
  fi
  # No all-clear marker → an incident may be active. Deploy-blocking wording → BLOCK.
  if printf '%s' "$body" | grep -qiE 'deploy(ment)?s?[^.<]{0,80}(paused|unavailable|halted|disabled)'; then
    STATUS_STATE="BLOCK"; STATUS_REASON="official status page reports deployments paused/unavailable"; return 0
  fi
  if printf '%s' "$body" | grep -qiE 'investigating|identified|monitoring|degraded|outage|partial|maintenance'; then
    STATUS_STATE="CAUTION"; STATUS_REASON="an active incident/degradation is reported; deployment applicability uncertain"; return 0
  fi
  STATUS_STATE="UNKNOWN"; STATUS_REASON="status page content not interpretable"
}

# ── Check 4: current production application health (read-only GET) ────────────
check_health() {
  local body rc
  set +e
  HEALTH_HTTP="$(curl -s -m "$CURL_TIMEOUT" -o /tmp/preflight-health.$$ -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)"; rc=$?
  body="$(cat /tmp/preflight-health.$$ 2>/dev/null || true)"; rm -f /tmp/preflight-health.$$
  set -e
  if [ $rc -ne 0 ] || [ -z "$HEALTH_HTTP" ]; then
    HEALTH_STATE="UNKNOWN"; HEALTH_REASON="health endpoint unreachable"; return 0
  fi
  # Non-HTTP transports (e.g. file:// fixtures in tests) report code 000 with a body:
  # classify by retrieved content in that case.
  if [ "$HEALTH_HTTP" = "000" ] && [ -n "$body" ]; then HEALTH_HTTP="200"; fi
  if [ "$HEALTH_HTTP" = "200" ] && printf '%s' "$body" | grep -q '"status":"ok"'; then
    HEALTH_STATE="PASS"; HEALTH_REASON="current production reports status ok (HTTP 200)"
  elif [ "$HEALTH_HTTP" = "200" ] || [ "$HEALTH_HTTP" = "503" ]; then
    HEALTH_STATE="CAUTION"; HEALTH_REASON="health endpoint responded HTTP $HEALTH_HTTP without status ok (degraded)"
  else
    HEALTH_STATE="UNKNOWN"; HEALTH_REASON="unexpected health response HTTP $HEALTH_HTTP"
  fi
  # NOTE: current health never proves the NEW deployment will be accepted or healthy,
  # and an unhealthy current production does not block shipping a fix (existing policy).
}

# ── Check 5: migration readiness (result consumed from the fail-closed parent) ─
check_migrations() {
  case "$MIGRATIONS_RESULT" in
    0)             MIG_STATE="PASS";    MIG_REASON="0 pending migrations (fail-closed check ran in deploy-production.sh)";;
    not-provided)  MIG_STATE="UNKNOWN"; MIG_REASON="migration result not provided to preflight";;
    ERR)           MIG_STATE="UNKNOWN"; MIG_REASON="migration status could not be determined (no DB access)";;
    *)             MIG_STATE="BLOCK";   MIG_REASON="$MIGRATIONS_RESULT migration(s) pending — parent should have failed closed";;
  esac
}

check_deployments; check_status_page; check_health; check_migrations

# ── Overall classification: BLOCK > UNKNOWN > CAUTION > PASS ─────────────────
OVERALL="PASS"
for s in "$DEPLOY_STATE" "$STATUS_STATE" "$HEALTH_STATE" "$MIG_STATE"; do
  case "$s" in
    BLOCK) OVERALL="BLOCK";;
    UNKNOWN) [ "$OVERALL" != "BLOCK" ] && OVERALL="UNKNOWN";;
    CAUTION) [ "$OVERALL" = "PASS" ] && OVERALL="CAUTION";;
  esac
done
PERMITTED=true; [ "$OVERALL" = "BLOCK" ] && PERMITTED=false

# ── Evidence artifact (redacted; atomic tmp+mv; no secrets ever) ─────────────
mkdir -p "$ART_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT="$ART_DIR/$TS-railway-production-preflight.json"
CLI_VERSION="$("$RAILWAY_BIN" --version 2>/dev/null | head -1 || echo unknown)"
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
CLEAN_TREE=true; [ -n "$(git status --porcelain 2>/dev/null)" ] && CLEAN_TREE=false
TMP="$(mktemp "$ART_DIR/.tmp.XXXXXX")"
DEPLOY_STATE="$DEPLOY_STATE" DEPLOY_REASON="$DEPLOY_REASON" DEPLOY_ID="$DEPLOY_ID" DEPLOY_STATUS="$DEPLOY_STATUS" \
STATUS_STATE="$STATUS_STATE" STATUS_REASON="$STATUS_REASON" STATUS_URL="$STATUS_URL" \
HEALTH_STATE="$HEALTH_STATE" HEALTH_REASON="$HEALTH_REASON" HEALTH_HTTP="$HEALTH_HTTP" HEALTH_URL="$HEALTH_URL" \
MIG_STATE="$MIG_STATE" MIG_REASON="$MIG_REASON" OVERALL="$OVERALL" PERMITTED="$PERMITTED" \
CLI_VERSION="$CLI_VERSION" GIT_SHA="$GIT_SHA" GIT_BRANCH="$GIT_BRANCH" CLEAN_TREE="$CLEAN_TREE" \
TARGET_PROJECT="$TARGET_PROJECT" TARGET_ENV="$TARGET_ENV" TARGET_SERVICE="$TARGET_SERVICE" TS_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
node -e '
const e = process.env;
const doc = {
  schema: "deploy-preflight@1",
  invoked_at: e.TS_ISO,
  commit: e.GIT_SHA, branch: e.GIT_BRANCH, clean_tree: e.CLEAN_TREE === "true",
  target: { project: e.TARGET_PROJECT, environment: e.TARGET_ENV, service: e.TARGET_SERVICE,
            verified_by: "railway-guard.sh (fail-closed, ran before preflight)" },
  railway_cli_version: e.CLI_VERSION,
  checks: {
    deployment_visibility: { state: e.DEPLOY_STATE, reason: e.DEPLOY_REASON,
      latest_deployment: e.DEPLOY_ID ? { id: e.DEPLOY_ID, status: e.DEPLOY_STATUS } : null,
      source: "railway deployment list (documented informational)" },
    public_status: { state: e.STATUS_STATE, reason: e.STATUS_REASON, source: e.STATUS_URL,
      not_exhaustive: "covers significant, widespread incidents only" },
    current_application_health: { state: e.HEALTH_STATE, reason: e.HEALTH_REASON,
      http: e.HEALTH_HTTP || null, source: e.HEALTH_URL,
      caveat: "does not prove the new deployment will be accepted or healthy" },
    migration_readiness: { state: e.MIG_STATE, reason: e.MIG_REASON,
      source: "deploy-production.sh fail-closed check (migration-status.mjs)" },
  },
  overall: e.OVERALL,
  deployment_permitted: e.PERMITTED === "true",
  overrides_in_effect: [],
  redaction: "no secrets, tokens, variable values, cookies, or connection strings are recorded",
};
process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
' > "$TMP"
mv "$TMP" "$ARTIFACT"

# ── Operator summary ─────────────────────────────────────────────────────────
say "target:            $TARGET_PROJECT / $TARGET_ENV / $TARGET_SERVICE (guard-verified)"
say "deployment state:  [$DEPLOY_STATE] $DEPLOY_REASON"
say "public status:     [$STATUS_STATE] $STATUS_REASON"
say "current health:    [$HEALTH_STATE] $HEALTH_REASON"
say "migrations:        [$MIG_STATE] $MIG_REASON"
say "evidence:          $ARTIFACT"
case "$OVERALL" in
  PASS)
    say "✓ PREFLIGHT PASS — no known read-only evidence currently blocks attempting the Railway deployment." ;;
  CAUTION)
    warn "PREFLIGHT CAUTION — proceeding, but review the flagged check(s) above." ;;
  UNKNOWN)
    warn "PREFLIGHT UNKNOWN — one or more read-only signals could not be established."
    warn "Unknown platform state is NOT evidence of health. Proceeding because nothing"
    warn "confirms a blocker; railway up will fail safely if the platform refuses." ;;
  BLOCK)
    printf '  \033[31m✗ PREFLIGHT BLOCK — %s\033[0m\n' "confirmed evidence blocks this deployment attempt (see above)."
    exit 1 ;;
esac
exit 0
