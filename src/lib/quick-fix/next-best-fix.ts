// ─────────────────────────────────────────────────────────────────────────────
// NEXT BEST FIX — for an existing customer, the strongest fixable defect that is
// NOT already-delivered work. Never re-sells a completed SKU unless the issue has
// genuinely reappeared. Operator-visible recommendation, not auto-outreach.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { assessFixability } from "./fixability";

export interface NextBestFixInput {
  /** SKUs the customer already purchased/delivered. */
  purchasedSkuKeys: string[];
  /** Fresh candidate offers from a re-inspection. */
  candidateOffers: QuickFixOffer[];
  /** SKUs whose defect genuinely reappeared (may be re-offered). */
  reappearedSkuKeys?: string[];
}

export interface NextBestFix {
  offer: QuickFixOffer | null;
  fixabilityScore: number;
  reason: string;
}

export function nextBestFix(input: NextBestFixInput): NextBestFix {
  const purchased = new Set(input.purchasedSkuKeys);
  const reappeared = new Set(input.reappearedSkuKeys ?? []);

  const eligible = input.candidateOffers
    .filter((o) => o.quickFixEligible)
    // Exclude an offer whose bundled SKUs are all already delivered (unless reappeared).
    .filter((o) => o.capabilityKeys.some((k) => !purchased.has(k) || reappeared.has(k)))
    .map((o) => ({ o, fix: assessFixability(o) }))
    .filter((x) => x.fix.readyToSell)
    .sort((a, b) => b.fix.score - a.fix.score);

  if (!eligible.length) {
    return { offer: null, fixabilityScore: 0, reason: "no new fixable defect beyond what's already delivered" };
  }
  const best = eligible[0];
  return { offer: best.o, fixabilityScore: best.fix.score, reason: `next best fix: ${best.o.scope.offerName} (score ${best.fix.score})` };
}
