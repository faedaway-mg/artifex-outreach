// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATION POLICY — how far an offer may travel without operator sign-off.
//
//   MANUAL        every generated offer requires approval before anything.
//   ASSISTED      offer + checkout are prepared automatically; operator approves
//                 before any outreach. (PRODUCTION DEFAULT.)
//   AUTO_ELIGIBLE predefined safe offer classes MAY auto-enter outreach if every
//                 gate passes — never enabled by default; graduated deliberately.
//
// The default is ASSISTED. Nothing here can trigger a send by itself — the send
// path retains its own independent safe-hold + recipient gates. This only decides
// whether an offer is *allowed* to be queued for outreach automatically.
// ─────────────────────────────────────────────────────────────────────────────
import type { AutomationLevel } from "./types";

export const DEFAULT_AUTOMATION_LEVEL: AutomationLevel = "ASSISTED";

/** Offer classes (capability keys) that MAY be graduated to AUTO_ELIGIBLE later. */
export const AUTO_ELIGIBLE_CAPABILITY_ALLOWLIST: string[] = [
  // Deliberately empty until a class has proven conversion + zero-incident delivery.
];

export interface AutoDecisionInput {
  level: AutomationLevel;
  capabilityKeys: string[];
  quickFixEligible: boolean;
  evidenceSufficient: boolean;
  clearsMarginGate: boolean;
  purchaseReady: boolean;
}

export interface AutoDecision {
  /** May this offer be auto-queued for outreach without per-offer approval? */
  mayAutoQueue: boolean;
  /** Does it still require explicit operator approval? */
  requiresApproval: boolean;
  reason: string;
}

/**
 * Decide the outreach posture for an offer. Fail-closed: anything short of a fully
 * gated AUTO_ELIGIBLE offer on an allow-listed class requires operator approval.
 */
export function decideAutomation(input: AutoDecisionInput): AutoDecision {
  if (input.level !== "AUTO_ELIGIBLE") {
    return { mayAutoQueue: false, requiresApproval: true, reason: `policy is ${input.level} — operator approval required` };
  }
  const allGatesPass = input.quickFixEligible && input.evidenceSufficient && input.clearsMarginGate && input.purchaseReady;
  if (!allGatesPass) {
    return { mayAutoQueue: false, requiresApproval: true, reason: "one or more gates (eligibility/evidence/margin/purchase) not satisfied" };
  }
  const allAllowlisted = input.capabilityKeys.length > 0 && input.capabilityKeys.every((k) => AUTO_ELIGIBLE_CAPABILITY_ALLOWLIST.includes(k));
  if (!allAllowlisted) {
    return { mayAutoQueue: false, requiresApproval: true, reason: "capability class is not on the AUTO_ELIGIBLE allow-list" };
  }
  return { mayAutoQueue: true, requiresApproval: false, reason: "AUTO_ELIGIBLE class with all gates passing" };
}
