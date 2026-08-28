// DEV-ONLY visual preview of the ClosingPanel across synthetic states, for browser
// screenshot verification (Gate 5). Returns 404 in production. Uses only synthetic
// data — no store, no provider, no network. Select a state with ?state=<key>.
import { notFound } from "next/navigation";
import { ClosingPanel } from "@/components/lead/ClosingPanel";
import type { ClosingView, ScheduleRow } from "@/lib/billing/closing-view";

function row(over: Partial<ScheduleRow>): ScheduleRow {
  return { key: "deposit", label: "Deposit", amountCents: 725_000, trigger: "on_signature", eligible: true, invoiceState: "not-created", invoiceId: null, hostedInvoiceUrl: null, ...over };
}
function base(over: Partial<ClosingView> = {}): ClosingView {
  return {
    entity: { issuerId: "artifex-systems", legalEntity: "Artifex Labs Systems LLC" },
    agreement: { number: "AL-A-2026-001", version: 1, status: "signed", signed: true },
    schedule: [row({}), row({ key: "balance", label: "Final balance", amountCents: 725_000, trigger: "on_acceptance", eligible: false })],
    money: { currency: "usd", invoicedCents: 0, collectedCents: 0, refundedCents: 0, disputedCents: 0, outstandingCents: 0, payoutStatus: "unverified", bankReceiptStatus: "unverified" },
    retainer: { present: false, monthlyAmountCents: null, currency: "usd", activationBlocked: true, missingDecisions: [], note: "" },
    mode: "test",
    nextAction: { label: "Prepare the deposit invoice", kind: "draft" },
    payoutCaveat: "Collected = confirmed by Stripe. Payout to Relay and bank receipt are separate, aggregate across payments and fees, and are not verified here.",
    ...over,
  };
}

const STATES: Record<string, ClosingView> = {
  normal: base(),
  unsigned: base({ agreement: { number: "AL-A-2026-002", version: 1, status: "approved", signed: false }, nextAction: { label: "Awaiting signature", kind: "await-external", blockerReason: "The agreement is not signed yet." }, schedule: [row({ eligible: false }), row({ key: "balance", label: "Final balance", trigger: "on_acceptance", eligible: false })] }),
  pending: base({
    schedule: [row({ invoiceState: "issued", hostedInvoiceUrl: "https://invoice.stripe.com/i/x" }), row({ key: "balance", label: "Final balance", trigger: "on_acceptance", eligible: false })],
    money: { currency: "usd", invoicedCents: 725_000, collectedCents: 0, refundedCents: 0, disputedCents: 0, outstandingCents: 725_000, payoutStatus: "unverified", bankReceiptStatus: "unverified" },
    nextAction: { label: "Awaiting deposit payment", kind: "await-external" },
  }),
  refund: base({
    schedule: [row({ invoiceState: "partially_refunded" }), row({ key: "balance", label: "Final balance", trigger: "on_acceptance", eligible: true, invoiceState: "disputed" })],
    money: { currency: "usd", invoicedCents: 1_450_000, collectedCents: 625_000, refundedCents: 100_000, disputedCents: 725_000, outstandingCents: 0, payoutStatus: "unverified", bankReceiptStatus: "unverified" },
    nextAction: { label: "Review dispute on Final balance", kind: "await-external", blockerReason: "A dispute is open." },
  }),
  retainer: base({ retainer: { present: true, monthlyAmountCents: 150_000, currency: "usd", activationBlocked: true, missingDecisions: ["cadence", "start trigger", "cancellation policy", "minimum term", "automatic-charge consent"], note: "" } }),
  long: base({
    entity: { issuerId: "artifex-systems", legalEntity: "Artifex Labs Systems LLC" },
    agreement: { number: "AL-A-2026-000123", version: 7, status: "signed", signed: true },
    schedule: [row({ label: "Deposit — Northwestern Metropolitan Hospitality Group International Holdings", amountCents: 12_500_000, invoiceState: "paid" }), row({ key: "m2", label: "Milestone 2", amountCents: 87_650_000, trigger: "on_acceptance", eligible: true })],
    money: { currency: "usd", invoicedCents: 100_150_000, collectedCents: 12_500_000, refundedCents: 0, disputedCents: 0, outstandingCents: 87_650_000, payoutStatus: "unverified", bankReceiptStatus: "unverified" },
  }),
};

export default function ClosingPreviewPage({ searchParams }: { searchParams: { state?: string } }) {
  if (process.env.NODE_ENV === "production") notFound();
  const key = searchParams.state && STATES[searchParams.state] ? searchParams.state : "normal";
  return (
    <div className="mx-auto max-w-2xl p-4">
      <p className="mb-2 text-xs text-neutral-500">DEV PREVIEW · ClosingPanel · state=<b>{key}</b></p>
      <ClosingPanel view={STATES[key]} agreementId="agr_preview" />
    </div>
  );
}
