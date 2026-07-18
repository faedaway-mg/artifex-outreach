// ─────────────────────────────────────────────────────────────────────────────
// Live webhook activation self-test (Phase 3). Sends SIGNED test events to the
// deployed Resend webhook endpoint and verifies signature validation, replay
// protection, auth, handler execution, and duplicate protection.
//
// It NEVER sends email. It writes at most ONE benign audit row: a signed
// `email.sent` event (which the handler intentionally ignores) delivered twice to
// prove dedup — tagged with a selftest id so it's obvious in the audit table.
//
// Usage:
//   RESEND_WEBHOOK_SECRET=whsec_... npx tsx scripts/comms/webhook-selftest.ts \
//     [--url https://outreach.artifexlabs.tech]
import "../loadEnv";
import { createHmac } from "node:crypto";

const URL_BASE = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1] ?? "https://outreach.artifexlabs.tech";
const ENDPOINT = `${URL_BASE.replace(/\/+$/, "")}/api/webhooks/resend`;
const secret = process.env.RESEND_WEBHOOK_SECRET;

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "✓" : "✗"}  ${name.padEnd(34)} ${detail}`);
  ok ? pass++ : fail++;
}

function sign(id: string, tsSec: number, body: string): string {
  const key = Buffer.from((secret ?? "").replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${tsSec}.${body}`).digest("base64");
}
async function post(headers: Record<string, string>, body: string): Promise<{ status: number; json: any }> {
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log(`\nWebhook activation self-test → ${ENDPOINT}`);
  console.log("=".repeat(64));
  if (!secret) {
    console.log("  ✗  RESEND_WEBHOOK_SECRET not set — cannot sign test events. Aborting.");
    process.exit(1);
  }
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Unsigned request → 401 (auth enforced, nothing written).
  {
    const { status } = await post({}, JSON.stringify({ type: "email.opened", data: { email_id: "selftest" } }));
    check("unsigned → 401", status === 401, `got ${status}`);
  }
  // 2. Tampered/bad signature → 401.
  {
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "selftest" } });
    const { status } = await post({ "svix-id": "st-bad", "svix-timestamp": String(nowSec), "svix-signature": "v1,not-a-real-signature" }, body);
    check("bad signature → 401", status === 401, `got ${status}`);
  }
  // 3. Valid signature but stale timestamp → 401 (replay guard).
  {
    const staleTs = nowSec - 3600;
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "selftest" } });
    const { status } = await post({ "svix-id": "st-replay", "svix-timestamp": String(staleTs), "svix-signature": sign("st-replay", staleTs, body) }, body);
    check("stale timestamp → 401 (replay)", status === 401, `got ${status}`);
  }
  // 4. Valid signed event, handler executes → 200. (email.sent is intentionally
  //    ignored by the handler, so no delivery state is created.)
  const evtId = `selftest-${nowSec}`;
  const body = JSON.stringify({ type: "email.sent", created_at: new Date(nowSec * 1000).toISOString(), data: { email_id: `selftest-${nowSec}` } });
  {
    const { status, json } = await post({ "svix-id": evtId, "svix-timestamp": String(nowSec), "svix-signature": sign(evtId, nowSec, body) }, body);
    check("valid signed event → 200", status === 200, `got ${status} result=${json.result}`);
    check("handler executed (ignored type)", json.result === "ignored", `result=${json.result}`);
  }
  // 5. Same event id again → duplicate (dedup / idempotency).
  {
    const { status, json } = await post({ "svix-id": evtId, "svix-timestamp": String(nowSec), "svix-signature": sign(evtId, nowSec, body) }, body);
    check("duplicate delivery → deduped", status === 200 && json.result === "duplicate", `result=${json.result}`);
  }

  console.log("=".repeat(64));
  console.log(`${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed. No email was sent.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
