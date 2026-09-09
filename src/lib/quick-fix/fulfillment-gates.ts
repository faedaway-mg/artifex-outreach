// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT GATES + PERSISTED-COMPLETION (Part A/B).
//
// Server-side authority for advancing a paid job. A job may NOT reach DELIVERED /
// COMPLETE until the required QA items pass AND a production retest is on record —
// read from the PERSISTED job sub-state (qaState + runbookState/evidence), never
// from client-supplied flags. The completion report is derived ONLY from persisted
// facts (evidence artifacts + QA state), so it can never claim something we did not
// actually record.
// ─────────────────────────────────────────────────────────────────────────────
import type { JobRecord } from "./store";
import type { QuickFixOffer, JobState } from "./types";
import { buildRunbook, normalizePlatform, type Platform } from "./fulfillment-center";
import { buildCompletionReport, type CompletionReport, type CompletionEvidence } from "./completion";

/** The runbook step id that represents a production (live URL) retest. */
export const PRODUCTION_RETEST_STEP = "retest-prod";

export interface DeliveryGate {
  ok: boolean;
  missingQa: string[];
  productionRetestDone: boolean;
  hasBeforeEvidence: boolean;
  hasAfterEvidence: boolean;
  blockers: string[];
}

/** Whether the persisted job satisfies the gates required to move to DELIVERED/COMPLETE.
 *  Reads ONLY persisted facts: qaState (per QA checklist item), runbookState (production
 *  retest step), and evidence (before/after proof). */
export function deliveryGate(offer: QuickFixOffer, job: JobRecord, platform: Platform): DeliveryGate {
  const rb = buildRunbook(offer, platform);
  const qaState = job.qaState ?? {};
  const missingQa = rb.qaChecklist.filter((item) => qaState[item]?.done !== true);
  // Production retest: either the runbook step is marked done OR a "test" evidence
  // artifact demonstrating the live retest exists.
  const stepDone = job.runbookState?.steps?.[PRODUCTION_RETEST_STEP]?.done === true;
  const testEvidence = (job.evidence ?? []).some((e) => e.kind === "test");
  const productionRetestDone = stepDone || testEvidence;
  const hasBeforeEvidence = (job.evidence ?? []).some((e) => e.kind === "before");
  const hasAfterEvidence = (job.evidence ?? []).some((e) => e.kind === "after");
  const blockers: string[] = [];
  if (missingQa.length) blockers.push(`${missingQa.length} QA item(s) not passed`);
  if (!productionRetestDone) blockers.push("Production retest not recorded (mark the live-URL retest or upload a test artifact)");
  if (!hasBeforeEvidence) blockers.push("Before-state evidence missing");
  if (!hasAfterEvidence) blockers.push("After-state evidence missing");
  return { ok: blockers.length === 0, missingQa, productionRetestDone, hasBeforeEvidence, hasAfterEvidence, blockers };
}

/** States that require the delivery gate to have been satisfied to enter. */
export function transitionRequiresGate(to: JobState): boolean {
  return to === "DELIVERED" || to === "COMPLETE";
}

/** Build a CompletionEvidence bundle DERIVED ONLY from persisted job facts — no
 *  client input, no fabricated verification. */
export function persistedEvidence(offer: QuickFixOffer, job: JobRecord, platform: Platform): CompletionEvidence {
  const before = (job.evidence ?? []).find((e) => e.kind === "before");
  const after = (job.evidence ?? []).find((e) => e.kind === "after");
  const rb = buildRunbook(offer, platform);
  const qaState = job.qaState ?? {};
  // Verification lines = the QA items actually marked passed (persisted facts only).
  const verification = rb.qaChecklist.filter((item) => qaState[item]?.done === true);
  return {
    beforeRef: before?.storageKey ?? before?.url ?? null,
    afterRef: after?.storageKey ?? after?.url ?? null,
    verification,
  };
}

/** Build the completion report from persisted facts only. */
export function persistedCompletionReport(offer: QuickFixOffer, job: JobRecord, detectedPlatform: string | null, completedAt: string): CompletionReport {
  const platform = normalizePlatform(detectedPlatform);
  return buildCompletionReport(offer, persistedEvidence(offer, job, platform), completedAt);
}
