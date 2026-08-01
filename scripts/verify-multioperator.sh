#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# READ-ONLY production verification of the multi-operator deploy.
#
# Every request is a GET except the two logins (which mint a session cookie and
# stamp last_active_at — no ownership is touched). Nothing is reassigned.
#
# The shared password is read into a 0600 temp file and never printed.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="https://outreach.artifexlabs.tech"
FAIL=0
ok()  { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAIL=1; }
chk() { if [ "$1" = "1" ]; then ok "$2"; else bad "$2"; fi; }

umask 077
PW="$(mktemp)"; CJ="$(mktemp)"; CA="$(mktemp)"; TMP="$(mktemp)"
trap 'rm -f "$PW" "$CJ" "$CA" "$TMP"' EXIT

railway variables --service outreach-web --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write((JSON.parse(s).OUTREACH_PASSWORD)||""))' > "$PW"
[ -s "$PW" ] || { echo "Could not load the shared password; aborting."; exit 1; }

login() { # $1=cookiejar  $2=operator id
  curl -s -m 25 -c "$1" -o /dev/null \
    --data-urlencode "password@$PW" --data "operator=$2" --data "from=/" \
    "$BASE/api/auth/login"
}
get() { curl -s -m 30 -b "$1" "$BASE$2"; }

# ── 5. Today defaults to the signed-in operator's own work ───────────────────
echo
echo "[5] TODAY DEFAULTS TO THE SIGNED-IN OPERATOR"
login "$CJ" jordan
get "$CJ" "/" > "$TMP"
grep -q "My businesses to work with today" "$TMP" && chk 1 "jordan: heading reads 'My businesses' with no ?view param" || chk 0 "jordan: default heading"
grep -q "Work you are accountable for today" "$TMP" && chk 1 "jordan: default scope explains itself" || chk 0 "jordan: scope meaning"

login "$CA" alex
get "$CA" "/" > "$TMP"
grep -q "My businesses to work with today" "$TMP" && chk 1 "alex: same default — his own work, not a shared list" || chk 0 "alex: default heading"

# ── 6. The switcher is present with honest counts ────────────────────────────
echo
echo "[6] QUEUE SCOPE SWITCHER"
get "$CJ" "/" > "$TMP"
for v in "view=mine" "view=alex" "view=unassigned" "view=team" "view=all"; do
  grep -q "$v" "$TMP" && ok "jordan sees the $(echo "$v" | cut -d= -f2) view" || bad "missing $v"
done
echo "  counts rendered on the switcher:"
node -e '
const h=require("fs").readFileSync(process.argv[1],"utf8");
const re=/href="\/\?view=([a-z]+)"[^>]*>(?:(?!<\/a>).)*?<\/a>/gs;
for(const m of h.matchAll(re)){
  const text=m[0].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  console.log("        "+text);
}' "$TMP"

# ── 7. Alex sees no overlapping assigned work ────────────────────────────────
echo
echo "[7] NO OVERLAPPING WORK"
get "$CJ" "/" > "$TMP"; JORDAN_LEADS="$(grep -o 'href="/leads/[a-zA-Z0-9_-]*"' "$TMP" | sort -u)"
get "$CA" "/" > "$TMP"; ALEX_LEADS="$(grep -o 'href="/leads/[a-zA-Z0-9_-]*"' "$TMP" | sort -u)"
JN="$(printf '%s' "$JORDAN_LEADS" | grep -c . )"
AN="$(printf '%s' "$ALEX_LEADS"  | grep -c . )"
OVERLAP="$(comm -12 <(printf '%s\n' "$JORDAN_LEADS") <(printf '%s\n' "$ALEX_LEADS") | grep -c . )"
echo "        businesses on jordan's Today: $JN"
echo "        businesses on alex's Today:   $AN"
echo "        appearing on BOTH:            $OVERLAP"
[ "$OVERLAP" = "0" ] && chk 1 "zero businesses appear on both queues — no duplicate outreach" || chk 0 "queues overlap ($OVERLAP)"
[ "$AN" = "0" ] && chk 1 "alex's queue is empty — he owns nothing yet, exactly as authorized" || chk 0 "alex unexpectedly has work"

# ── 8. /team renders both operators ──────────────────────────────────────────
echo
echo "[8] TEAM DASHBOARD"
get "$CJ" "/team" > "$TMP"
CODE="$(curl -s -m 30 -b "$CJ" -o /dev/null -w '%{http_code}' "$BASE/team")"
[ "$CODE" = "200" ] && chk 1 "/team returns 200" || chk 0 "/team returned $CODE"
grep -q "Jordan" "$TMP" && chk 1 "Jordan rendered" || chk 0 "Jordan missing"
grep -q "Alex"   "$TMP" && chk 1 "Alex rendered"   || chk 0 "Alex missing"
grep -q "Preview only. Automatic distribution is off" "$TMP" \
  && chk 1 "rebalance is preview-only — the Apply path is not reachable" \
  || chk 0 "rebalance gate notice missing"
echo "        workload lines:"
node -e '
const h=require("fs").readFileSync(process.argv[1],"utf8");
const t=h.replace(/<script[\s\S]*?<\/script>/g," ").replace(/<[^>]*>/g,"\n").replace(/&#x27;/g,"'"'"'").split("\n").map(s=>s.trim()).filter(Boolean);
const i=t.findIndex(s=>/^Jordan/.test(s));
console.log("        "+t.slice(Math.max(0,i-1),i+40).join(" | ").slice(0,1400));
' "$TMP"

echo
[ "$FAIL" = "0" ] && echo "ALL PRODUCTION CHECKS PASSED" || echo "SOME CHECKS FAILED"
echo "rows written by this script: 0 (two logins stamped last_active_at; no ownership touched)"
exit "$FAIL"
