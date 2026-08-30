// GATE 3 (part A) — follow the APP's intended deposit issuance path in test mode and
// obtain the REAL Stripe hosted invoice/payment URL WITHOUT sending an email (the
// adapter finalizes with auto_advance=false and never calls /send). Refuses live key
// / non-local DB. Prints the hosted URL for the browser walkthrough. Never prints secrets.
import "./loadEnv";
import { isTestKey } from "../src/lib/payments/stripe-invoice";
import { insertAgreement, getInvoice } from "../src/lib/repo";
import { prepareMilestoneInvoice, issueMilestoneInvoice } from "../src/lib/billing/invoicing-service";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";
import { buildClosingView } from "../src/lib/billing/closing-view";

async function main() {
  if (!isTestKey(process.env.STRIPE_SECRET_KEY ?? "")) throw new Error("REFUSING: not a test key.");
  const db = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error(`REFUSING: non-local DB: ${db}`);

  const a = makeAgreement({ status: "signed" });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  const ag = await insertAgreement({ ...rest, agreementNumber: `AL-A-J${Date.now()}` });
  const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
  if (!prep.ok || !prep.invoice) throw new Error("prepare failed: " + prep.reason);

  // App's real issue path (test-mode gated) → creates the Stripe send_invoice invoice + hosted URL.
  const issued = await issueMilestoneInvoice(prep.invoice.id, { actor: "jordan", actorRole: "founder", requireTestMode: true });
  if (!issued.ok || !issued.invoice) throw new Error("issue failed: " + issued.reason);

  // Idempotency: issuing again must NOT create a second Stripe invoice/charge.
  const again = await issueMilestoneInvoice(prep.invoice.id, { actor: "jordan", actorRole: "founder", requireTestMode: true });

  const inv = await getInvoice(prep.invoice.id);
  const view = buildClosingView({ agreement: ag, invoices: [inv!], payments: [], acceptedKeys: [], sendingEnabled: false });
  const balance = view.schedule.find((s) => s.key === "balance");

  console.log(JSON.stringify({
    appInvoiceId: inv!.id,
    agreementId: ag.id,
    agreementVersion: inv!.agreementVersion,
    issuerLegalEntity: view.entity.legalEntity,
    amountCents: inv!.amountCents,
    currency: inv!.currency,
    providerInvoiceId: inv!.providerInvoiceId,
    hostedInvoiceUrl: inv!.hostedInvoiceUrl,
    state: inv!.state,
    reissueSameProviderInvoice: again.invoice?.providerInvoiceId === inv!.providerInvoiceId,
    balanceEligibleBeforeAcceptance: balance?.eligible ?? null,
    balanceState: balance?.invoiceState ?? null,
  }, null, 2));
}
main().catch((e) => { console.error("GATE3 ISSUE ERROR:", e.message); process.exit(1); });
