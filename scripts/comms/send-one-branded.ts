// ─────────────────────────────────────────────────────────────────────────────
// Final customer-experience validation — send exactly ONE real branded prospect message
// through the ONE canonical compliant boundary a business would receive:
//   approveAndFreezeQuickReview → prepareCanonicalReviewOutreach → submitCanonicalColdOutreach
//
// This no longer assembles its own email or calls dispatchStep with separately-rendered content
// (that bypass is removed). It models a REAL business's profile for authentic content, freezes that
// business's Quick Review PDF (rendered ONCE), and delivers the EXACT canonical message — same
// subject / bodies / footer / headers / frozen PDF filename + SHA the dry-run previews. Delivery is
// gated: the recipient must be the configured test address (recipient lock) and --yes-send-real-email
// is required. Nothing sends unless a real provider is configured (Resend) or one is injected.
//
// Usage:
//   railway run --service outreach-web -- env DATABASE_URL="<public>" \
//     ./node_modules/.bin/tsx scripts/comms/send-one-branded.ts --to you@domain.com --yes-send-real-email
// ─────────────────────────────────────────────────────────────────────────────
import "../loadEnv";
import { listLeads, getBusinessIntelligence } from "../../src/lib/repo";
import { approveAndFreezeQuickReview } from "../../src/lib/outreach/quick-review-freeze";
import { prepareCanonicalReviewOutreach, submitCanonicalColdOutreach } from "../../src/lib/comms/canonical-outreach";

const to = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1] ?? (() => { const i = process.argv.indexOf("--to"); return i >= 0 ? process.argv[i + 1] : undefined; })();
const ack = process.argv.includes("--yes-send-real-email");
function refuse(m: string): never { console.error(`REFUSED: ${m}`); process.exit(1); }

async function main() {
  if (!to) refuse("no --to=<address> given.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to!)) refuse(`--to is not a valid email: ${to}`);
  if (!ack) refuse("this SENDS A REAL EMAIL. Re-run with --yes-send-real-email to confirm.");

  // Borrow a real business's profile so the content is authentic, then FREEZE its Quick Review.
  const leads = await listLeads();
  let source: (typeof leads)[number] | null = null;
  for (const l of leads) {
    const bi = await getBusinessIntelligence(l.id);
    if (bi?.profile?.businessProfile && ((bi.profile.businessProfile as { opportunities?: unknown[] }).opportunities?.length ?? 0) > 0) { source = l; break; }
  }
  if (!source) refuse("no business with an intelligence profile found to model the message on.");

  const frozen = await approveAndFreezeQuickReview({ leadId: source!.id });
  if (!frozen.ok) refuse(`could not approve/freeze the Quick Review: ${frozen.reason}`);

  // Assemble through the ONE canonical boundary (frozen PDF + compliant footer + signed unsubscribe).
  const prepared = await prepareCanonicalReviewOutreach({ leadId: source!.id, recipient: to! });
  if (!prepared.ok) refuse(`canonical prepare failed: ${prepared.reason}`);

  console.log("\n" + "=".repeat(64));
  console.log(`SENDING ONE REAL BRANDED PROSPECT MESSAGE (canonical boundary) → ${to}`);
  console.log("=".repeat(64));
  console.log(`  Business modeled : ${source!.businessName}`);
  console.log(`  Subject          : ${prepared.prepared.subject}`);
  console.log(`  Attachment       : ${prepared.prepared.filename}`);
  console.log(`  Attachment SHA256: ${prepared.prepared.pdfSha256}  (${prepared.prepared.byteSize} bytes, frozen v${prepared.prepared.reviewVersion})`);
  console.log(`  Idempotency key  : ${prepared.prepared.idempotencyKey}`);

  // Submit through the single submit core (final suppression + recipient-lock + provider + ambiguous).
  const res = await submitCanonicalColdOutreach(prepared.prepared);
  console.log(`\n  Result           : ${res.sent ? `ACCEPTED (id ${res.providerMessageId})` : `NOT SENT — ${res.errorCode ?? ""} ${res.reason ?? ""}`}`);
  process.exit(res.sent ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
