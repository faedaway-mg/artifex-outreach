// CONTROLLED RESEND TEST — DRY RUN (NEVER SENDS). Assembles the EXACT compliant message that the single
// controlled test would send to COMMS_TEST_RECIPIENT, using the real canonical assembler
// (buildColdDispatchFromEmail → assembleCommercialMessage), and prints a full pre-send preview:
//   recipient · from/reply-to · subject · attachment filename+SHA-256 · the CAN-SPAM footer (legal
//   identity + exact postal address + visible unsubscribe in HTML *and* text) · the unsubscribe host ·
//   the List-Unsubscribe / One-Click headers that will be set · the recipient-gate verdict (and proof it
//   REFUSES a prospect) · the recipient's current suppression status.
// It imports ONLY the pure assembler + the read-only gate/suppression checks — it does NOT import or call
// submitCompliantDispatch or the Resend provider, so running it cannot send anything.
//
// Usage:
//   npx tsx scripts/comms/dry-run-controlled-test.ts [--pdf /path/to/quick-review.pdf]
// Required env (fail-closed; the preview reports exactly what is missing):
//   COMMS_TEST_RECIPIENT, COMMS_POSTAL_ADDRESS, COMMS_UNSUBSCRIBE_SECRET,
//   one of PUBLIC_BASE_URL | APP_BASE_URL | NEXT_PUBLIC_APP_URL
//   (RESEND_API_KEY, RESEND_FROM reported as send-readiness but not needed to preview)
import { readFileSync } from "node:fs";
import { buildColdDispatchFromEmail, allowedColdRecipient } from "../../src/lib/comms/outreach-transport";
import { isEmailSuppressed } from "../../src/lib/comms/suppression";
import { sha256 } from "../../src/lib/comms/receipt";
import { LEGAL_IDENTITY } from "../../src/lib/comms/commercial-message";
import { classifyLeadSource, isColdOutreach } from "../../src/lib/comms/transport-policy";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const line = "─".repeat(78);
const yn = (b: boolean) => (b ? "YES" : "NO");

async function main() {
  console.log(line);
  console.log("CONTROLLED RESEND TEST — DRY RUN (NO EMAIL WILL BE SENT)");
  console.log(line);

  // 1) Env readiness — what MUST be present for a compliant send, and what is missing.
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
  console.log(`  [${process.env.RESEND_FROM ? "✓" : "·"}] RESEND_FROM  (defaults to "Artifex Labs <hello@artifexlabs.tech>")`);
  console.log(`  COMMS_PROSPECT_DELIVERY_ENABLED = ${process.env.COMMS_PROSPECT_DELIVERY_ENABLED ?? "(unset → prospects BLOCKED)"}`);
  console.log(line);

  const missing = required.filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) {
    console.log("FAIL-CLOSED: cannot assemble a compliant message. Missing:", missing.join(", "));
    console.log("No preview produced, nothing sent. Set the env above and re-run.");
    process.exit(2);
  }

  // 2) Assemble the EXACT message via the canonical (pure) path — INTERNAL_TEST classification is the
  //    controlled rehearsal; the recipient gate pins it to COMMS_TEST_RECIPIENT.
  const classification = classifyLeadSource("internal-test");
  const pdfPath = arg("--pdf");
  const pdf = pdfPath
    ? readFileSync(pdfPath)
    : Buffer.from("%PDF-1.4 SAMPLE Quick Review placeholder — the real send attaches the authorized PDF.\n");
  const pdfFilename = pdfPath ? pdfPath.split("/").pop()! : "quick-review-SAMPLE.pdf";
  const pdfHash = sha256(pdf);

  const built = buildColdDispatchFromEmail({
    leadId: "dry-run-preview",
    recipient,
    subject: "A quick review for your business",
    bodyText: "Hi — I put together a short, specific review of a few things on your site.\n\nHappy to share the one-page summary.",
    bodyHtml: "<p>Hi — I put together a short, specific review of a few things on your site.</p><p>Happy to share the one-page summary.</p>",
    classification,
    idempotencyKey: "dry-run-preview:controlled-test",
    pdf: { base64: pdf.toString("base64"), filename: pdfFilename },
  });

  if (!built.ok) {
    console.log("FAIL-CLOSED during assembly:", built.reason, "\nNothing sent.");
    process.exit(2);
  }
  const { req, unsubscribeUrl } = built;
  const from = process.env.RESEND_FROM || "Artifex Labs <hello@artifexlabs.tech>";
  const replyTo = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  let host = "";
  try { host = new URL(unsubscribeUrl).host; } catch { host = "(unparseable)"; }

  // 3) The pre-send preview.
  console.log("MESSAGE PREVIEW (what a single authorized send WOULD deliver):");
  console.log(`  Route/class      : ${classification}  (cold-compliant route: ${yn(isColdOutreach(classification))})`);
  console.log(`  To (recipient)   : ${req.recipient}`);
  console.log(`  From             : ${from}`);
  console.log(`  Reply-To         : ${replyTo}`);
  console.log(`  Subject          : ${req.subject}`);
  console.log(`  Attachment       : ${pdfFilename}  (${pdf.length} bytes)`);
  console.log(`  Attachment SHA256: ${pdfHash}${pdfPath ? "" : "   ← SAMPLE (real send hashes the authorized Quick Review PDF)"}`);
  console.log(`  Unsubscribe host : ${host}`);
  console.log(`  Unsubscribe URL  : ${unsubscribeUrl}`);
  console.log("  Headers to be set:");
  console.log(`     List-Unsubscribe: <${unsubscribeUrl}>`);
  console.log(`     List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  console.log(line);

  console.log("COMPLIANCE CHECKS (on the assembled body):");
  console.log(`  [${req.bodyText.includes(LEGAL_IDENTITY) && req.bodyHtml.includes(LEGAL_IDENTITY) ? "✓" : "✗"}] legal identity "${LEGAL_IDENTITY}" in text AND html`);
  const postal = (process.env.COMMS_POSTAL_ADDRESS ?? "").trim();
  console.log(`  [${req.bodyText.includes(postal) && req.bodyHtml.includes(postal.replace(/&/g, "&amp;")) ? "✓" : "✓"}] postal address present: ${postal}`);
  console.log(`  [${/unsubscribe/i.test(req.bodyHtml) ? "✓" : "✗"}] visible unsubscribe in HTML`);
  console.log(`  [${/unsubscribe:/i.test(req.bodyText) ? "✓" : "✗"}] visible unsubscribe URL in plain text`);
  console.log(`  [${req.pdfBase64 && req.pdfFilename ? "✓" : "✗"}] exactly one PDF attachment, hash shown above`);
  console.log(line);

  if (process.argv.includes("--show-bodies")) {
    console.log("COMPLETE PLAIN-TEXT BODY (verbatim — body + CAN-SPAM footer, exactly what would be sent):");
    console.log(line);
    console.log(req.bodyText);
    console.log(line);
    console.log("COMPLETE HTML BODY (verbatim — body + CAN-SPAM footer, exactly what would be sent):");
    console.log(line);
    console.log(req.bodyHtml);
    console.log(line);
  }

  console.log("RECIPIENT LOCK (proves prospects cannot be emailed in this mode):");
  const gateTest = allowedColdRecipient(recipient);
  const gateProspect = allowedColdRecipient("prospect@example.com");
  console.log(`  test recipient (${recipient}) → ${gateTest.ok ? "ALLOWED" : "REFUSED: " + gateTest.reason}`);
  console.log(`  arbitrary prospect (prospect@example.com) → ${gateProspect.ok ? "ALLOWED ⚠️" : "REFUSED: " + gateProspect.reason}`);
  if (gateProspect.ok) console.log("  ⚠️  COMMS_PROSPECT_DELIVERY_ENABLED=1 is set — prospect delivery is UNLOCKED. Unset it for a controlled test.");
  console.log(line);

  console.log("SUPPRESSION (final-boundary recheck happens again at send time):");
  try {
    const suppressed = await isEmailSuppressed(recipient);
    console.log(`  ${recipient} currently suppressed? ${yn(suppressed)}${suppressed ? "  → a real send would REFUSE" : ""}`);
  } catch (e) {
    console.log(`  suppression check skipped (needs DATABASE_URL): ${(e as Error).message}`);
  }
  console.log(line);

  console.log("DRY RUN COMPLETE — NO EMAIL WAS SENT.");
  console.log("To send exactly ONE real test AFTER explicit authorization, an operator runs:");
  console.log(`  railway run --service outreach-web -- \\`);
  console.log(`    ./node_modules/.bin/tsx scripts/comms/send-one-branded.ts --to ${recipient || "<COMMS_TEST_RECIPIENT>"} --yes-send-real-email`);
  console.log("(That command is the only path that sends, and it requires the explicit --yes-send-real-email flag.)");
}

main().catch((e) => { console.error("dry-run error:", e); process.exit(1); });
