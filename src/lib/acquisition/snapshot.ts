// ─────────────────────────────────────────────────────────────────────────────
// Immutable approval snapshots.
//
// At approval time we freeze the decision context onto the plan record so a
// historical approval never changes when the underlying Lead is later edited.
// The Approval Center shows LIVE values before approval; audit/history views
// read these SNAPSHOT values after approval.
//
// Pure + deterministic: given the lead and its related records it returns the
// exact same values the Approval Center computed live. Anything genuinely
// unavailable is stored as null (never recomputed later).
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Finding, Deliverable, Video, ConceptPreview, AcquisitionStrategy } from "../types";
import { assetReadiness, ASSET_LABELS } from "./assets";
import { contactConfidence, websiteHealthSummary } from "./summary";
import { formatRange } from "../utils";

export interface ApprovalSnapshotInput {
  strategy: AcquisitionStrategy;
  findings: Finding[];
  deliverables: Deliverable[];
  previews: ConceptPreview[];
  videos: Video[];
  contacts: number;
}

export interface ApprovalSnapshot {
  estimatedValueSnapshot: string | null;
  assetReadinessSnapshot: boolean | null;
  assetMissingSnapshot: string[] | null;
  contactConfidenceSnapshot: string | null;
  websiteHealthSnapshot: string | null;
}

export function buildApprovalSnapshot(lead: Lead, input: ApprovalSnapshotInput): ApprovalSnapshot {
  const readiness = assetReadiness(input.strategy, {
    brief: input.deliverables.some((d) => d.status !== "draft"),
    concept: input.previews.some((p) => p.status !== "Not Started" && p.status !== "Archived"),
    video: input.videos.some((v) => v.videoUrl),
    research: input.findings.some((f) => f.approved) || Boolean(lead.opportunitySummary),
  });
  const cc = contactConfidence(lead, input.contacts);

  return {
    // Value is genuinely unavailable when both bounds are unset → null.
    estimatedValueSnapshot:
      lead.estimatedValueLow == null && lead.estimatedValueHigh == null
        ? null
        : formatRange(lead.estimatedValueLow, lead.estimatedValueHigh),
    assetReadinessSnapshot: readiness.ready,
    assetMissingSnapshot: readiness.missing.map((a) => ASSET_LABELS[a]),
    contactConfidenceSnapshot: cc.level,
    websiteHealthSnapshot: websiteHealthSummary(lead, input.findings),
  };
}
