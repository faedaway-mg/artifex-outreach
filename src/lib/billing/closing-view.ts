// ─────────────────────────────────────────────────────────────────────────────
// Closing view-model — the single operator-facing status for a deal's close.
//
// Pure: given the agreement, its invoices/payments, recorded acceptances, and the
// live-sending flag, it computes exactly what the UI must show and the ONE next
// action. It never contacts anyone or moves money; it labels which actions would.
// The React surface (Gate 8) renders this; visual acceptance is reported
// separately (a browser driver is required and is not installed in this lane).
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement, Invoice, Payment } from "../types";
import { resolveIssuerForSnapshot } from "./issuer";
import { deriveSchedule, isMilestoneEligible, type MilestoneTerm } from "./milestones";
import { moneyView, PAYOUT_CAVEAT, type MoneyView } from "./payout";
import { retainerReadiness, type RetainerReadiness } from "./retainer";
import { shouldSkipForPaidCheckoutDeposit } from "./invoice";

export type ActionKind = "draft" | "move-money" | "await-external" | "none";

export interface ScheduleRow {
  key: string;
  label: string;
  amountCents: number;
  trigger: MilestoneTerm["trigger"];
  eligible: boolean;
  invoiceState: Invoice["state"] | "not-created" | "paid-via-checkout";
  invoiceId: string | null;
  hostedInvoiceUrl: string | null;
}

export interface NextAction {
  label: string;
  kind: ActionKind;
  blockerReason?: string;
}

export interface ClosingView {
  entity: { issuerId: string; legalEntity: string };
  agreement: { number: string; version: number; status: Agreement["status"]; signed: boolean };
  schedule: ScheduleRow[];
  money: MoneyView;
  retainer: RetainerReadiness;
  /** "live" when external issuing would really send/charge; "test" otherwise. */
  mode: "live" | "test";
  nextAction: NextAction;
  payoutCaveat: string;
}

export function buildClosingView(input: {
  agreement: Agreement;
  invoices: Invoice[];
  payments: Payment[];
  acceptedKeys?: string[];
  sendingEnabled: boolean;
}): ClosingView {
  const { agreement, invoices, payments } = input;
  const snap = agreement.contentSnapshot;
  const issuer = resolveIssuerForSnapshot(snap);
  const signed = agreement.status === "signed";
  const acceptedKeys = input.acceptedKeys ?? [];
  const terms = deriveSchedule(snap);

  const byMilestone = new Map(invoices.map((i) => [i.milestoneKey, i]));
  const schedule: ScheduleRow[] = terms.map((t) => {
    const inv = byMilestone.get(t.key);
    let invoiceState: ScheduleRow["invoiceState"] = inv ? inv.state : "not-created";
    if (!inv && shouldSkipForPaidCheckoutDeposit(t.key, payments)) invoiceState = "paid-via-checkout";
    return {
      key: t.key,
      label: t.label,
      amountCents: t.amountCents,
      trigger: t.trigger,
      eligible: isMilestoneEligible(t, { agreementSigned: signed, acceptedKeys }),
      invoiceState,
      invoiceId: inv?.id ?? null,
      hostedInvoiceUrl: inv?.hostedInvoiceUrl ?? null,
    };
  });

  return {
    entity: { issuerId: issuer.id, legalEntity: issuer.legalEntity },
    agreement: { number: snap.agreementNumber, version: agreement.version, status: agreement.status, signed },
    schedule,
    money: moneyView(invoices, snap.currency),
    retainer: retainerReadiness(snap),
    mode: input.sendingEnabled ? "live" : "test",
    nextAction: computeNextAction(agreement, schedule),
    payoutCaveat: PAYOUT_CAVEAT,
  };
}

function computeNextAction(agreement: Agreement, schedule: ScheduleRow[]): NextAction {
  if (agreement.status === "declined" || agreement.status === "voided") {
    return { label: "Create a new agreement version", kind: "draft" };
  }
  if (agreement.status !== "signed") {
    return { label: "Awaiting signature", kind: "await-external", blockerReason: "The agreement is not signed yet." };
  }
  // Deposit first.
  const deposit = schedule.find((s) => s.key === "deposit");
  if (deposit && deposit.invoiceState === "not-created") return { label: "Prepare the deposit invoice", kind: "draft" };
  if (deposit && deposit.invoiceState === "draft") return { label: "Issue the deposit invoice", kind: "move-money" };
  if (deposit && deposit.invoiceState === "issued") return { label: "Awaiting deposit payment", kind: "await-external" };
  if (deposit && (deposit.invoiceState === "processing")) return { label: "Deposit payment processing", kind: "await-external" };

  // Then the next eligible, unbilled milestone.
  const nextEligible = schedule.find((s) => s.key !== "deposit" && s.eligible && s.invoiceState === "not-created");
  if (nextEligible) return { label: `Prepare the ${nextEligible.label} invoice`, kind: "draft" };
  const draftMilestone = schedule.find((s) => s.key !== "deposit" && s.invoiceState === "draft");
  if (draftMilestone) return { label: `Issue the ${draftMilestone.label} invoice`, kind: "move-money" };

  const blockedMilestone = schedule.find((s) => s.key !== "deposit" && !s.eligible && s.invoiceState === "not-created");
  if (blockedMilestone) {
    return { label: `Record acceptance for ${blockedMilestone.label}`, kind: "draft", blockerReason: "Milestone not yet accepted." };
  }

  const allPaidOrRetained = schedule.every((s) => ["paid", "paid-via-checkout", "partially_refunded"].includes(s.invoiceState));
  if (allPaidOrRetained) return { label: "All milestones collected — confirm kickoff requirements", kind: "none" };

  const awaiting = schedule.find((s) => ["issued", "processing"].includes(s.invoiceState));
  if (awaiting) return { label: `Awaiting payment on ${awaiting.label}`, kind: "await-external" };

  return { label: "Review closing status", kind: "none" };
}
