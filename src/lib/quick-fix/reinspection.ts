// ─────────────────────────────────────────────────────────────────────────────
// REINSPECTION — controlled re-analysis of delivered customers. NOT immediate,
// NOT spam. After a cooldown, a customer becomes eligible for re-inspection; a new
// concrete defect can be matched to a new SKU and QUEUED for operator visibility.
// No automatic customer outreach here.
// ─────────────────────────────────────────────────────────────────────────────
import type { CustomerRecord } from "./lifecycle";

export const REINSPECTION_COOLDOWN_DAYS = 45;

export interface ReinspectionDecision {
  eligible: boolean;
  daysSinceDelivery: number | null;
  reason: string;
}

export function eligibleForReinspection(customer: CustomerRecord, nowMs: number, cooldownDays = REINSPECTION_COOLDOWN_DAYS): ReinspectionDecision {
  if (!customer.lastDeliveredAt) {
    return { eligible: false, daysSinceDelivery: null, reason: "no delivery yet — nothing to re-inspect" };
  }
  const days = (nowMs - new Date(customer.lastDeliveredAt).getTime()) / 86_400_000;
  if (days < cooldownDays) {
    return { eligible: false, daysSinceDelivery: Math.floor(days), reason: `cooldown: ${Math.floor(days)}/${cooldownDays} days since delivery` };
  }
  return { eligible: true, daysSinceDelivery: Math.floor(days), reason: `${Math.floor(days)} days since delivery — eligible for re-inspection` };
}
