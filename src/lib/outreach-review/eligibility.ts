// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH REVIEW — READY_FOR_NARRATION eligibility (mandate 28). "Outreach Reviews" are the pre-meeting
// personalized website-review videos (formerly "Proposal Videos"). "Client Proposal" is reserved for the
// POST-discovery-call artifact. This module is the ONE canonical gate that decides whether a business is in
// the operator's narration queue, plus the backlog state machine + refill policy. Pure + deterministic.
// ─────────────────────────────────────────────────────────────────────────────

// The canonical Outreach-Review funnel (mandate 28 terminology).
export const OUTREACH_REVIEW_FUNNEL = [
  "target-identified", "outreach-review-prepared", "narration-recorded", "video-rendered",
  "outreach-review-approved", "email-scheduled-sent", "discovery-call-booked", "client-proposal-prepared", "closed-won",
] as const;

// Backlog states surfaced to the operator (each equals its canonical list).
export type BacklogState =
  | "researching" | "needs-evidence" | "needs-recipient" | "script-being-prepared" | "ready-for-narration"
  | "audio-uploaded" | "rendering" | "needs-attention" | "ready-to-approve" | "scheduled" | "sent";

export interface NarrationReadinessInput {
  // scoring (mandate 27)
  scoreBand: "PRIORITY_A" | "PRIORITY_B" | "REVIEW" | "DO_NOT_PREPARE" | "INELIGIBLE";
  hasDisqualifier: boolean;
  verifiedBusinessIdentity: boolean;
  recipientVerified: boolean;
  recipientResolutionTracked: boolean; // an explicitly tracked resolution state counts (mandate 28)
  hasStrongReputationSignal: boolean;
  hasSpecificWebsiteFinding: boolean;
  hasSupportedConsequence: boolean;
  narrationEvidenceBacked: boolean;
  statementEvidenceMapComplete: boolean;
  hasUnsupportedClaims: boolean;
  excessiveSimilarity: boolean;
  narrationQualityPasses: boolean;
  hasCurrentScriptRevision: boolean;
  hasExistingAudioForCurrentRevision: boolean; // active audio already bound to THIS revision
  hasCanonicalCompletedRender: boolean;        // a completed render that makes narration unnecessary
  // downstream lifecycle signals (for state classification)
  renderState?: "none" | "queued" | "rendering" | "ready" | "failed";
  packageState?: "none" | "ready-to-approve" | "scheduled" | "sent";
  needsAttention?: boolean;
}

export interface NarrationReadiness {
  ready: boolean;                 // true ⟺ state === "ready-for-narration"
  state: BacklogState;
  blockers: string[];             // why it is NOT ready-for-narration (empty when ready)
}

/** Classify a business into its canonical backlog state and decide READY_FOR_NARRATION. */
export function narrationReadiness(i: NarrationReadinessInput): NarrationReadiness {
  // Downstream lifecycle wins first (already past narration).
  if (i.packageState === "sent") return { ready: false, state: "sent", blockers: [] };
  if (i.packageState === "scheduled") return { ready: false, state: "scheduled", blockers: [] };
  if (i.packageState === "ready-to-approve") return { ready: false, state: "ready-to-approve", blockers: [] };
  if (i.needsAttention || i.renderState === "failed") return { ready: false, state: "needs-attention", blockers: ["needs operator attention"] };
  if (i.renderState === "ready" || i.hasCanonicalCompletedRender) return { ready: false, state: "rendering", blockers: ["a completed render already exists — narration not needed"] };
  if (i.renderState === "rendering" || i.renderState === "queued") return { ready: false, state: "rendering", blockers: [] };
  if (i.hasExistingAudioForCurrentRevision) return { ready: false, state: "audio-uploaded", blockers: [] };

  // Eligibility for narration.
  const blockers: string[] = [];
  if (!(i.scoreBand === "PRIORITY_A" || i.scoreBand === "PRIORITY_B")) blockers.push("not a qualifying PRIORITY_A/B target");
  if (i.hasDisqualifier) blockers.push("has a hard disqualifier");
  if (!i.verifiedBusinessIdentity) blockers.push("business identity not verified");
  if (!(i.recipientVerified || i.recipientResolutionTracked)) blockers.push("no verified/tracked recipient");
  if (!i.hasStrongReputationSignal) blockers.push("no strong reputation signal");
  if (!i.hasSpecificWebsiteFinding) blockers.push("no specific website finding");
  if (!i.hasSupportedConsequence) blockers.push("no supported business consequence");
  if (!i.narrationEvidenceBacked) blockers.push("narration not evidence-backed");
  if (!i.statementEvidenceMapComplete) blockers.push("incomplete statement→evidence map");
  if (i.hasUnsupportedClaims) blockers.push("narration contains unsupported claims");
  if (i.excessiveSimilarity) blockers.push("excessive cross-company similarity");
  if (!i.narrationQualityPasses) blockers.push("narration quality fails");
  if (!i.hasCurrentScriptRevision) blockers.push("no current script revision");

  if (blockers.length === 0) return { ready: true, state: "ready-for-narration", blockers: [] };

  // Not ready → classify WHY, into the most-informative pre-narration state.
  if (!(i.scoreBand === "PRIORITY_A" || i.scoreBand === "PRIORITY_B") || !i.verifiedBusinessIdentity || i.hasDisqualifier) return { ready: false, state: "researching", blockers };
  if (!i.hasStrongReputationSignal || !i.hasSpecificWebsiteFinding || !i.hasSupportedConsequence) return { ready: false, state: "needs-evidence", blockers };
  if (!(i.recipientVerified || i.recipientResolutionTracked)) return { ready: false, state: "needs-recipient", blockers };
  return { ready: false, state: "script-being-prepared", blockers };
}

// ── BACKLOG COUNTS + REFILL POLICY ───────────────────────────────────────────────
export interface BacklogConfig { target: number; refillThreshold: number; max: number }
export const DEFAULT_BACKLOG: BacklogConfig = { target: 100, refillThreshold: 80, max: 100 };

export type BacklogCounts = Record<BacklogState, number> & { total: number };

export function tallyBacklog(states: BacklogState[]): BacklogCounts {
  const c: any = { researching: 0, "needs-evidence": 0, "needs-recipient": 0, "script-being-prepared": 0, "ready-for-narration": 0, "audio-uploaded": 0, rendering: 0, "needs-attention": 0, "ready-to-approve": 0, scheduled: 0, sent: 0, total: states.length };
  for (const s of states) c[s] = (c[s] ?? 0) + 1;
  return c as BacklogCounts;
}

export interface RefillDecision { shouldRefill: boolean; readyCount: number; deficit: number; target: number }
/** Refill kicks in when READY_FOR_NARRATION falls BELOW the threshold; restores toward target (never past max). */
export function refillDecision(readyCount: number, cfg: BacklogConfig = DEFAULT_BACKLOG): RefillDecision {
  const shouldRefill = readyCount < cfg.refillThreshold;
  const deficit = shouldRefill ? Math.min(cfg.target, cfg.max) - readyCount : 0;
  return { shouldRefill, readyCount, deficit: Math.max(0, deficit), target: Math.min(cfg.target, cfg.max) };
}
