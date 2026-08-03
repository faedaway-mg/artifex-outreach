// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY provider health + sender identity check.
//
// Runs inside the production service's environment so the Resend key is present,
// and prints ONLY booleans, issue strings, the sender DOMAIN, and latency. The key
// itself is never read into a printable value, never logged, never echoed.
//
// It calls Resend's GET /domains (an authenticated read). It NEVER calls /emails.
// No message can leave the system through this script.
//
//   railway run --service outreach-web -- ./node_modules/.bin/tsx scripts/verify-provider-health.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

let fail = 0;
const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail = 1; };
const chk = (c: boolean, m: string) => (c ? ok(m) : bad(m));

// Never print a secret. Only ever report whether one is present.
const present = (v: string | undefined) => (v && v.length > 0 ? "<set>" : "<NOT SET>");

async function main() {
  const { getEmailProvider } = await import("../src/lib/comms/provider");

  console.log("\n[P1] PROVIDER SELECTION");
  const provider = getEmailProvider();
  console.log(`        provider name  = ${provider.name}`);
  console.log(`        provider mode  = ${provider.meta.mode}`);
  console.log(`        canSend        = ${provider.canSend}`);
  console.log(`        fromDomain     = ${JSON.stringify(provider.meta.fromDomain)}`);
  console.log(`        batchLimit     = ${provider.meta.batchLimit}`);
  chk(provider.name === "resend", "the live Resend provider is selected (not the mock)");
  chk(provider.meta.mode === "live", "provider mode is live");
  chk(provider.canSend === true, "provider reports it can send (API key present)");

  console.log("\n[P2] CREDENTIALS PRESENT (names only — no values)");
  console.log(`        RESEND_API_KEY        = ${present(process.env.RESEND_API_KEY)}`);
  console.log(`        RESEND_FROM           = ${present(process.env.RESEND_FROM)}`);
  console.log(`        RESEND_WEBHOOK_SECRET = ${present(process.env.RESEND_WEBHOOK_SECRET)}`);
  console.log(`        PUBLIC_BASE_URL       = ${present(process.env.PUBLIC_BASE_URL)}`);
  console.log(`        APP_BASE_URL          = ${present(process.env.APP_BASE_URL)}`);
  console.log(`        NEXT_PUBLIC_APP_URL   = ${present(process.env.NEXT_PUBLIC_APP_URL)}`);
  console.log(`        AUTH_SECRET           = ${present(process.env.AUTH_SECRET)}`);

  console.log("\n[P3] SENDER IDENTITY");
  const cfg = await provider.verifyConfiguration();
  console.log(`        verifyConfiguration.ok = ${cfg.ok}`);
  for (const i of cfg.issues) console.log(`          issue: ${i}`);
  chk(cfg.ok, "sender identity is fully configured (verified From address present)");
  // The From ADDRESS is not a secret — it is printed on every email we send.
  console.log(`        RESEND_FROM (the visible From) = ${JSON.stringify(process.env.RESEND_FROM ?? null)}`);

  console.log("\n[P4] AUTHENTICATION + REACHABILITY (authenticated GET /domains — never /emails)");
  const health = await provider.healthCheck();
  console.log(`        healthCheck.ok = ${health.ok}`);
  console.log(`        latencyMs      = ${health.latencyMs ?? "-"}`);
  for (const i of health.issues) console.log(`          issue: ${i}`);
  chk(health.ok, "Resend accepted the API key and is reachable");

  console.log("\n[P5] THE OPT-OUT LINK, IN THE REAL PRODUCTION ENVIRONMENT");
  const { unsubscribeUrlFor, listUnsubscribeHeaders } = await import("../src/lib/comms/unsubscribe");
  const probe = "lead_probe";
  const url = unsubscribeUrlFor(probe);
  console.log(`        unsubscribeUrlFor(<probe>) = ${url ? "<built ok>" : "null"}`);
  const hdrs = listUnsubscribeHeaders(probe, process.env.RESEND_FROM ?? "hello@artifexlabs.tech");
  console.log(`        List-Unsubscribe-Post      = ${hdrs["List-Unsubscribe-Post"] ?? "(absent)"}`);
  chk(url !== null, "a working per-lead unsubscribe URL can be built IN PRODUCTION");
  chk(Boolean(hdrs["List-Unsubscribe-Post"]), "RFC 8058 one-click unsubscribe header present IN PRODUCTION");

  console.log("\n[P6] SAFETY GATES AS PRODUCTION SEES THEM");
  console.log(`        OUTREACH_SENDING_ENABLED      = ${JSON.stringify(process.env.OUTREACH_SENDING_ENABLED ?? null)}`);
  console.log(`        COMMS_AUTOSEND_ENABLED        = ${JSON.stringify(process.env.COMMS_AUTOSEND_ENABLED ?? null)}`);
  console.log(`        OPERATOR_DISTRIBUTION_ENABLED = ${JSON.stringify(process.env.OPERATOR_DISTRIBUTION_ENABLED ?? null)}`);

  console.log(`\n${fail === 0 ? "ALL PROVIDER CHECKS PASSED" : "SOME PROVIDER CHECKS FAILED"}`);
  console.log("emails sent by this script: 0 · rows written: 0 · secrets printed: 0");
  process.exit(fail);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
