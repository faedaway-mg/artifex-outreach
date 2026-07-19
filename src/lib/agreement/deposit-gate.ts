// ─────────────────────────────────────────────────────────────────────────────
// Deposit hard gate. A deposit request must NEVER go out before a signed, current
// agreement exists. This pure predicate is the single source of truth, enforced at
// three layers: the domain (here), the server action, and the UI (disabled state).
// A disabled button is never the only guard.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement, Payment } from "../types";

export interface DepositGateResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * Whether a deposit for `payment` may be sent. `agreement` is the deposit's parent
 * agreement (or null if not found). `leadId` is the lead the operator is acting on.
 */
export function checkDepositAllowed(agreement: Agreement | null | undefined, payment: Payment | null | undefined, leadId: string): DepositGateResult {
  if (!payment) return deny("No deposit record exists.");
  if (payment.type !== "deposit") return deny("This payment is not a deposit.");
  if (!agreement) return deny("No agreement is associated with this deposit.");
  if (agreement.id !== payment.agreementId) return deny("Deposit does not belong to the referenced agreement.");
  if (agreement.leadId !== payment.leadId) return deny("Deposit and agreement belong to different leads.");
  if (agreement.leadId !== leadId) return deny("Agreement does not belong to this lead.");
  if (agreement.supersededById) return deny("This agreement has been superseded by a newer version.");
  if (agreement.status === "declined") return deny("The agreement was declined.");
  if (agreement.status === "voided") return deny("The agreement was voided.");
  if (agreement.status !== "signed") return deny("The agreement is not signed yet.");
  if (payment.status === "paid") return deny("This deposit has already been paid.");
  return { allowed: true, reason: null };
}

function deny(reason: string): DepositGateResult {
  return { allowed: false, reason };
}

export class DepositGateError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DepositGateError";
  }
}
