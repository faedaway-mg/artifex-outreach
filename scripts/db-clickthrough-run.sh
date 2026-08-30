#!/usr/bin/env bash
# Orchestrates the DB-backed intercepted click-through with a full app RESTART between
# stages (proving Postgres persistence). Providers intercepted; production flags OFF; real
# SignWell/Stripe credentials made unavailable. DB-backed: DATABASE_URL comes from .env.local
# (the local test DB) — it is NOT cleared here (unlike the in-memory rehearsal).
set -u
PORT="${PORT:-3100}"
BASE="http://localhost:${PORT}"
STATE_DIR="${STATE_DIR:-/tmp/db-ct}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
rm -rf "$STATE_DIR"; mkdir -p "$STATE_DIR"

start_server() {
  # Keys cleared so no real provider call is possible; fake e-sign provider enabled;
  # production flags OFF; provider signer config present (test-mode preflight needs it).
  SIGNWELL_API_KEY= STRIPE_SECRET_KEY= ESIGN_FAKE_PROVIDER=1 \
    PRODUCTION_SIGNING_ENABLED=false AGREEMENT_SENDING_ENABLED=false \
    AGREEMENT_PROVIDER_LEGAL_NAME="Artifex Labs Systems LLC d/b/a Artifex Labs" \
    AGREEMENT_PROVIDER_SIGNER_NAME="Jordan Jackson" \
    AGREEMENT_PROVIDER_SIGNER_EMAIL="contracts@artifexlabs.tech" \
    PORT="$PORT" nohup pnpm exec next dev -p "$PORT" > /tmp/db-ct-dev.log 2>&1 &
  for i in $(seq 1 45); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/login" 2>/dev/null)
    [ "$code" = "200" ] && { echo "  server ready (attempt $i)"; return 0; }
    sleep 1
  done
  echo "  SERVER FAILED TO START"; tail -5 /tmp/db-ct-dev.log; return 1
}
stop_server() { pkill -f "next dev -p ${PORT}" 2>/dev/null; sleep 1; }

run_stage() { echo "── stage: $1 (restart #$2) ──"; STATE_DIR="$STATE_DIR" BASE_URL="$BASE" STAGE="$1" pnpm exec node scripts/db-clickthrough.mjs; }

RC=0
stop_server
echo "▶ start #1"; start_server || exit 1
run_stage seed_approve 1 || RC=1
stop_server; echo "▶ restart #2 (between approval and authorization)"; start_server || exit 1
run_stage authorize 2 || RC=1
stop_server; echo "▶ restart #3 (before send)"; start_server || exit 1
run_stage send_sign 3 || RC=1
stop_server; echo "▶ restart #4 (prove consumed send-auth visible after restart)"; start_server || exit 1
run_stage verify_persist 4 || RC=1
stop_server

echo ""
echo "── PROOF ANALYSIS: one frozen PDF across approval → authorization → send → restart ──"
STATE_DIR="$STATE_DIR" pnpm exec node -e '
const fs=require("fs"); const dir=process.env.STATE_DIR;
const rows=fs.readFileSync(dir+"/proofs.jsonl","utf8").trim().split("\n").map(l=>JSON.parse(l));
let fail=0;
const shas=new Set(), sizes=new Set();
for(const r of rows){
  const f=r.frozen||{};
  console.log(`  ${r.label.padEnd(20)} storedSha=${(f.storedSha||"").slice(0,16)} recomputed=${(f.recomputedSha||"").slice(0,16)} size=${f.byteSize} approvalSha=${(r.approvalBindingSha||"").slice(0,16)} sendAuthSha=${(r.sendAuthSha||"").slice(0,16)}`);
  if(f.storedSha!==f.recomputedSha){console.log("   ✗ bytes changed (storedSha != recomputedSha)");fail++;}
  if(f.storedSha) shas.add(f.storedSha);
  if(f.byteSize!=null) sizes.add(f.byteSize);
}
const one=[...shas];
if(one.length!==1){console.log(`  ✗ frozen SHA differs across stages: ${one.map(s=>s.slice(0,12))}`);fail++;} else console.log(`  ✓ identical frozen SHA across ALL stages: ${one[0].slice(0,24)}…`);
if(sizes.size!==1){console.log(`  ✗ byte size differs: ${[...sizes]}`);fail++;} else console.log(`  ✓ identical byte size across ALL stages: ${[...sizes][0]}`);
// approval + send-auth reference the SAME frozen SHA where present
for(const r of rows){
  if(r.approvalBindingSha && one[0] && r.approvalBindingSha!==one[0]){console.log(`  ✗ ${r.label}: approval SHA != frozen SHA`);fail++;}
  if(r.sendAuthSha && one[0] && r.sendAuthSha!==one[0]){console.log(`  ✗ ${r.label}: send-auth SHA != frozen SHA`);fail++;}
}
if(!fail) console.log("  ✓ approval binding + send authorization both bind the identical frozen SHA");
console.log(fail?`PROOF FAILURES: ${fail}`:"PROOF: PASS");
process.exit(fail?1:0);
' || RC=1

echo ""
echo "$([ $RC -eq 0 ] && echo "DB-BACKED CLICK-THROUGH: ALL STAGES + PROOFS OK" || echo "DB-BACKED CLICK-THROUGH: FAILURES (rc=$RC)")"
exit $RC
