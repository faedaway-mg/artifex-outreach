// Prepare + issue the DEPOSIT invoice for a signed agreement, TEST MODE ONLY. The
// adapter refuses a live key when requireTestMode is set. Prints the hosted invoice URL.
// Usage: tsx scripts/stripe-deposit-invoice.ts <esignRequestId>
import "./loadEnv";
import { getAgreementByEsignRequestId } from "../src/lib/repo";
import { prepareMilestoneInvoice, issueMilestoneInvoice } from "../src/lib/billing/invoicing-service";

async function main() {
  const docId = process.argv[2];
  if (!docId) throw new Error("pass the esignRequestId (SignWell doc id)");
  const db = process.env.DATABASE_URL ?? ""; if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error("REFUSING: non-local DB");

  const ag = await getAgreementByEsignRequestId(docId);
  if (!ag) throw new Error("agreement not found for that doc id");
  if (ag.status !== "signed") throw new Error(`agreement status is ${ag.status}, not signed`);

  const actor = "jordan", actorRole = "founder" as const;
  const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor, actorRole, acceptedKeys: [] });
  console.log(`prepare: ok=${prep.ok} inserted=${prep.inserted} skipped=${prep.skipped ?? false} blocked=${prep.blocked ?? false} ${prep.reason ?? ""}`);
  if (!prep.ok || !prep.invoice) throw new Error("prepare failed: " + (prep.reason ?? ""));

  const issue = await issueMilestoneInvoice(prep.invoice.id, { actor, actorRole, requireTestMode: true });
  console.log(`issue: ok=${issue.ok} blocked=${issue.blocked ?? false} ${issue.reason ?? ""}`);
  if (!issue.ok || !issue.invoice) throw new Error("issue failed: " + (issue.reason ?? ""));

  const inv = issue.invoice;
  console.log(`\nINVOICE_ID=${inv.id}`);
  console.log(`state=${inv.state} amount=${inv.amountCents} ${inv.currency} milestone=${inv.milestoneKey}`);
  console.log(`providerInvoiceId=${inv.providerInvoiceId}`);
  console.log(`HOSTED_URL=${inv.hostedInvoiceUrl}`);
}
main().catch((e) => { console.error("INVOICE ERROR:", e.message); process.exit(1); });
