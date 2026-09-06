// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL TERMINAL REJECTION — pure core (mandate 21). ONE persistent operator disposition meaning
// "we have decided NOT to pursue this company." It is a terminal PIPELINE STAGE ("Rejected"), stored on
// the stable lead entity (by id, never by email), and it is DELIBERATELY DISTINCT from every other stop:
//   • recipient unsubscribe / opt-out            → a Suppression (UNSUBSCRIBED)   — recipient's choice
//   • legal / bounce / complaint suppression     → a Suppression (SUPPRESSED/DNC) — deliverability/legal
//   • temporary Hold                             → editorial `held`                — pause, not terminal
//   • insufficient evidence                      → review status / auto-route      — automated judgment
//   • failed rendering                           → render job state                — pipeline failure
// An internal rejection therefore NEVER writes a suppression/unsubscribe event and never falsely claims
// the recipient opted out. This file is pure (types only) so every gate can import isRejectedLead without
// a circular dependency; the side-effecting operation lives in ./rejection.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";

/** The append-only audit action recording a deliberate operator rejection. */
export const REJECTION_ACTION = "lead.rejected";
/** The terminal pipeline stage that marks a rejected company (excluded by every terminal-stage gate). */
export const REJECTED_STAGE = "Rejected";

/** The fixed operator-selectable reasons (mandate 21). "other" may carry a short free-text note. */
export const REJECTION_REASONS = [
  "outside-target-size",
  "poor-fit",
  "insufficient-evidence",
  "wrong-industry",
  "duplicate",
  "bad-contact",
  "other",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABEL: Record<RejectionReason, string> = {
  "outside-target-size": "Outside target company size",
  "poor-fit": "Poor fit",
  "insufficient-evidence": "Insufficient evidence",
  "wrong-industry": "Wrong industry",
  "duplicate": "Duplicate",
  "bad-contact": "Bad contact",
  "other": "Other",
};

export function isRejectionReason(v: unknown): v is RejectionReason {
  return typeof v === "string" && (REJECTION_REASONS as readonly string[]).includes(v);
}

/** THE canonical predicate every resolver/gate uses. Keyed to the stable entity's terminal stage. */
export function isRejectedLead(lead: Pick<Lead, "pipelineStage"> | null | undefined): boolean {
  return !!lead && lead.pipelineStage === REJECTED_STAGE;
}

export interface RejectResult {
  ok: boolean;
  leadId: string;
  disposition: "REJECTED";
  reason?: RejectionReason;
  /** true when the lead was ALREADY rejected — an idempotent repeat that appended no second event. */
  alreadyRejected: boolean;
  /** the stage the lead held immediately before rejection (preserved for truthful history / reversal). */
  priorStage: string | null;
  /** whether any email was ever sent to this company (→ UI shows "Stop future outreach", receipt preserved). */
  contacted: boolean;
  sent: boolean;
  /** a pending UNSENT scheduled binding was voided by this action. */
  cancelledBinding: boolean;
  /** count of pending follow-up plans stopped (contacted companies). */
  stoppedPlans: number;
  error?: string;
}

export interface RejectionRecord {
  reason: RejectionReason;
  note: string | null;
  priorStage: string | null;
  contacted: boolean;
  sent: boolean;
  actor: string;
  at: string;
}
