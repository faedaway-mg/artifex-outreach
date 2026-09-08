// ─────────────────────────────────────────────────────────────────────────────
// COMPLETION PROOF + REPORT — the evidence-backed "your fix is complete" artifact.
// Before/after evidence stays tied to the job. NO fabricated improvement metrics.
// Also models proof/testimonial CONSENT: customer data is never public without it.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { containsFabricatedClaim } from "./evidence-gate";

export interface CompletionEvidence {
  beforeRef: string | null; // storage key / url of before-state proof
  afterRef: string | null; // storage key / url of after-state proof
  verification: string[]; // e.g. ["Desktop", "Mobile", "Submission received"]
}

export interface CompletionReport {
  offerId: string;
  issue: string;
  changes: string[];
  verification: string[];
  beforeRef: string | null;
  afterRef: string | null;
  completedAt: string;
  /** True only when required evidence is present and no fabricated claim slipped in. */
  valid: boolean;
  problems: string[];
}

export function buildCompletionReport(offer: QuickFixOffer, evidence: CompletionEvidence, completedAt: string): CompletionReport {
  const problems: string[] = [];
  if (!evidence.beforeRef) problems.push("missing before-state evidence");
  if (!evidence.afterRef) problems.push("missing after-state evidence");
  if (!evidence.verification.length) problems.push("no verification recorded");
  const changes = offer.scope.includedItems;
  const blob = [offer.scope.problemBeingSolved, ...changes, ...evidence.verification].join(" ");
  if (containsFabricatedClaim(blob)) problems.push("report contains an unsupported metric claim");
  return {
    offerId: offer.offerId,
    issue: offer.scope.problemBeingSolved,
    changes,
    verification: evidence.verification,
    beforeRef: evidence.beforeRef,
    afterRef: evidence.afterRef,
    completedAt,
    valid: problems.length === 0,
    problems,
  };
}

// ── Proof / testimonial consent ────────────────────────────────────────────────
export type ProofConsentState = "NOT_REQUESTED" | "REQUESTED" | "APPROVED_NAMED" | "APPROVED_ANONYMIZED" | "DECLINED";

/** Whether ANY public use is permitted, and whether the company may be named. */
export function proofUsage(state: ProofConsentState): { public: boolean; named: boolean } {
  if (state === "APPROVED_NAMED") return { public: true, named: true };
  if (state === "APPROVED_ANONYMIZED") return { public: true, named: false };
  return { public: false, named: false };
}
