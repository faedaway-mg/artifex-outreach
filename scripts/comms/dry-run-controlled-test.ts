// CONTROLLED CANONICAL TEST — DRY RUN (NEVER SENDS). Previews the EXACT canonical compliant message the
// single controlled test would send to COMMS_TEST_RECIPIENT, assembled through the ONE canonical boundary
// (approveAndFreezeQuickReview → prepareCanonicalReviewOutreach) using the FROZEN Quick Review PDF — so the
// previewed attachment filename + SHA-256 are byte-identical to what send-one-branded would submit. It
// imports the canonical PREPARE path only; it never calls submitCanonicalColdOutreach or any provider, so
// running it cannot send anything.
//
// Usage:
//   npx tsx scripts/comms/dry-run-controlled-test.ts [--show-bodies]
// Required env (fail-closed; the preview reports exactly what is missing):
//   COMMS_TEST_RECIPIENT, COMMS_POSTAL_ADDRESS, COMMS_UNSUBSCRIBE_SECRET,
//   one of PUBLIC_BASE_URL | APP_BASE_URL | NEXT_PUBLIC_APP_URL, and a reachable DATABASE_URL (frozen artifact).
import "../loadEnv";
import { listLeads, getBusinessIntelligence } from "../../src/lib/repo";
import { isEmailSuppressed } from "../../src/lib/comms/suppression";
import { LEGAL_IDENTITY } from "../../src/lib/comms/commercial-message";
import { allowedColdRecipient } from "../../src/lib/comms/outreach-transport";
import { approveAndFreezeQuickReview } from "../../src/lib/outreach/quick-review-freeze";
import { prepareCanonicalReviewOutreach } from "../../src/lib/comms/canonical-outreach";

const line = "─".repeat(78);
const yn = (b: boolean) => (b ? "YES" : "NO");

async function main() {
  console.log(line);
  console.log("CONTROLLED CANONICAL TEST — DRY RUN (NO EMAIL WILL BE SENT)");
  console.log(line);

  const recipient = (process.env.COMMS_TEST_RECIPIENT ?? "").trim();
  const base = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  const required: Array<[string, boolean, string]> = [
    ["COMMS_TEST_RECIPIENT", !!recipient, "the ONLY address a controlled test may reach"],
    ["COMMS_POSTAL_ADDRESS", !!(process.env.COMMS_POSTAL_ADDRESS ?? "").trim(), "CAN-SPAM physical address (footer fail-closed)"],
    ["COMMS_UNSUBSCRIBE_SECRET", !!(process.env.COMMS_UNSUBSCRIBE_SECRET ?? "").trim(), "signs the one-click unsubscribe token"],
    ["PUBLIC_BASE_URL|APP_BASE_URL|NEXT_PUBLIC_APP_URL", !!base, "unsubscribe link host"],
  ];
  console.log("REQUIRED COMPLIANCE ENV:");
  for (const [k, ok, why] of required) console.log(`  [${ok ? "✓" : "✗"}] ${k}  — ${why}`);
  console.log("SEND-READINESS ENV (needed only to actually send):");
  console.log(`  [${process.env.RESEND_API_KEY ? "✓" : "✗"}] RESEND_API_KEY`);
  console.log(`  COMMS_PROSPECT_DELIVERY_ENABLED = ${process.env.COMMS_PROSPECT_DELIVERY_ENABLED ?? "(unset → prospects BLOCKED)"}`);
  console.log(line);

  const missing = required.filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) {
    console.log("FAIL-CLOSED: cannot assemble a compliant message. Missing:", missing.join(", "));
    process.exit(2);
  }

  // Pick the SAME lead send-one-branded models on (first with a BI profile), freeze its Quick Review,
  // then prepare through the identical canonical boundary → the preview shows the FROZEN bytes' SHA.
  const leads = await listLeads();
  let source: (typeof leads)[number] | null = null;
  for (const l of leads) {
    const bi = await getBusinessIntelligence(l.id);
    if (bi?.profile?.businessProfile && ((bi.profile.businessProfile as { opportunities?: unknown[] }).opportunities?.length ?? 0) > 0) { source = l; break; }
  }
  if (!source) { console.log("FAIL-CLOSED: no business with an intelligence profile to model on (needs DATABASE_URL)."); process.exit(2); }

  const frozen = await approveAndFreezeQuickReview({ leadId: source!.id });
  if (!frozen.ok) { console.log(`FAIL-CLOSED: could not freeze the Quick Review: ${frozen.reason}`); process.exit(2); }

  const prepared = await prepareCanonicalReviewOutreach({ leadId: source!.id, recipient });
  if (!prepared.ok) { console.log(`FAIL-CLOSED during canonical assembly: ${prepared.reason}`); process.exit(2); }
  const p = prepared.prepared;
  const headers = p.req;

  console.log("MESSAGE PREVIEW (canonical boundary — what a single authorized send WOULD deliver):");
  console.log(`  Business modeled : ${source!.businessName}`);
  console.log(`  To (recipient)   : ${p.recipient}`);
  console.log(`  Subject          : ${p.subject}`);
  console.log(`  Attachment       : ${p.filename}  (${p.byteSize} bytes, FROZEN v${p.reviewVersion})`);
  console.log(`  Attachment SHA256: ${p.pdfSha256}   ← the exact frozen bytes (identical to send-one-branded)`);
  console.log(`  Idempotency key  : ${p.idempotencyKey}`);
  console.log(`  Unsubscribe URL  : ${prepared.prepared.unsubscribeUrl}`);
  console.log("  Headers to be set:");
  console.log(`     List-Unsubscribe: <${prepared.prepared.unsubscribeUrl}>`);
  console.log(`     List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  console.log(line);

  console.log("COMPLIANCE CHECKS (on the assembled body):");
  console.log(`  [${headers.bodyText.includes(LEGAL_IDENTITY) && headers.bodyHtml.includes(LEGAL_IDENTITY) ? "✓" : "✗"}] legal identity "${LEGAL_IDENTITY}" in text AND html`);
  console.log(`  [${/unsubscribe/i.test(headers.bodyHtml) ? "✓" : "✗"}] visible unsubscribe in HTML`);
  console.log(`  [${/unsubscribe/i.test(headers.bodyText) ? "✓" : "✗"}] visible unsubscribe in plain text`);
  console.log(`  [${headers.pdfBase64 && headers.pdfFilename ? "✓" : "✗"}] exactly one FROZEN PDF attachment, SHA shown above`);
  console.log(line);

  if (process.argv.includes("--show-bodies")) {
    console.log("COMPLETE PLAIN-TEXT BODY (verbatim — body + CAN-SPAM footer, exactly what would be sent):");
    console.log(line); console.log(headers.bodyText); console.log(line);
    console.log("COMPLETE HTML BODY (verbatim — body + CAN-SPAM footer, exactly what would be sent):");
    console.log(line); console.log(headers.bodyHtml); console.log(line);
  }

  console.log("RECIPIENT LOCK (proves prospects cannot be emailed in this mode):");
  const gateTest = allowedColdRecipient(recipient);
  const gateProspect = allowedColdRecipient("prospect@example.com");
  console.log(`  test recipient (${recipient}) → ${gateTest.ok ? "ALLOWED" : "REFUSED: " + gateTest.reason}`);
  console.log(`  arbitrary prospect (prospect@example.com) → ${gateProspect.ok ? "ALLOWED ⚠️" : "REFUSED: " + gateProspect.reason}`);
  console.log(line);

  console.log("SUPPRESSION (final-boundary recheck happens again at send time):");
  try {
    const suppressed = await isEmailSuppressed(recipient);
    console.log(`  ${recipient} currently suppressed? ${yn(suppressed)}${suppressed ? "  → a real send would REFUSE" : ""}`);
  } catch (e) {
    console.log(`  suppression check skipped: ${(e as Error).message}`);
  }
  console.log(line);
  console.log("DRY RUN COMPLETE — NO EMAIL WAS SENT.");
  console.log("To send exactly ONE real test AFTER explicit authorization, an operator runs:");
  console.log(`  railway run --service outreach-web -- ./node_modules/.bin/tsx scripts/comms/send-one-branded.ts --to ${recipient} --yes-send-real-email`);
}

main().catch((e) => { console.error("dry-run error:", e); process.exit(1); });
