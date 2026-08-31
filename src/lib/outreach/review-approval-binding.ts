// ─────────────────────────────────────────────────────────────────────────────
// Quick Review approval binding — the immutable, version-bound record of EXACTLY what the
// operator approved for cold outreach: the lead, the review version, the business name, the
// substantive review CONTENT (a canonical digest), and the frozen PDF's identity (filename +
// content-type + SHA-256 + byte length + frozen timestamp + immutable blob key).
//
// A canonical digest of the content is recomputed at prepare/preview/send time; ANY drift in
// the substantive review content is rejected — a material change requires a NEW review version,
// a NEW frozen artifact, and a fresh approval (mirrors the closing agreement approval model).
//
// PURE (crypto only) — no persistence or rendering here; the record is stored by the approval
// orchestrator into the append-only audit log, and the bytes live in the blob store.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { canonicalize } from "../agreement/approval";
import type { QuickReview } from "./quick-review";

export const REVIEW_APPROVAL_RECORD_VERSION = 1;

/** The material, PDF-determining content of a Quick Review, reduced to a stable shape. The volatile
 *  brand logo DATA URI is deliberately excluded (a logo re-fetch must not invalidate an approval); the
 *  brand's provenance (sourceType/confidence) is kept. Everything a reader sees as substance is here. */
export function reviewContentShape(review: QuickReview): Record<string, unknown> {
  return {
    businessName: review.businessName,
    industryLabel: review.industryLabel,
    location: review.location,
    website: review.website,
    brand: review.brand ? { sourceType: review.brand.sourceType, confidence: review.brand.confidence } : null,
    findings: review.findings,
    presentations: review.presentations,
    openingHook: review.openingHook,
    start: review.start,
    cta: review.cta ?? null,
    status: review.status,
    observations: review.observations,
    whyItMatters: review.whyItMatters,
    recommendations: review.recommendations,
  };
}

/** sha256 hex over the canonical substantive content — the drift-detection fingerprint for re-approval. */
export function reviewContentDigest(review: QuickReview): string {
  return createHash("sha256").update(canonicalize(reviewContentShape(review))).digest("hex");
}

/** The material binding the operator approves — persisted verbatim into the approval audit record. */
export interface ReviewApprovalBinding {
  approvalRecordVersion: number;
  leadId: string;
  reviewVersion: number;
  businessName: string;
  reviewStatus: string;
  // Substantive-content identity (source-drift fingerprint)
  contentDigest: string;
  // The exact frozen document's identity
  frozenPdfSha256: string;
  byteSize: number;
  filename: string;
  contentType: string;
  blobKey: string;
  frozenAt: string;
  approvedBy: string;
}

/** sha256 hex of the canonical binding — the tamper fingerprint stored alongside the record. */
export function reviewApprovalDigest(binding: ReviewApprovalBinding): string {
  return createHash("sha256").update(canonicalize(binding)).digest("hex");
}

/** Compare a freshly-built content shape against the approved binding; itemize every drift reason
 *  (empty ⇒ no drift). Compares the substantive content digest and the recorded review identity. */
export function reviewBindingDriftReasons(approved: ReviewApprovalBinding, current: { contentDigest: string; businessName: string; reviewStatus: string }): string[] {
  const reasons: string[] = [];
  if (approved.contentDigest !== current.contentDigest) reasons.push("review content changed");
  if (approved.businessName !== current.businessName) reasons.push("business name changed");
  if (approved.reviewStatus !== current.reviewStatus) reasons.push("review sendability status changed");
  return reasons;
}

/** True-reasons when the approval binding is itself invalid/tampered (empty ⇒ intact). */
export function reviewApprovalIntactReasons(binding: ReviewApprovalBinding, digest: string): string[] {
  const reasons: string[] = [];
  if (reviewApprovalDigest(binding) !== digest) reasons.push("approval digest does not match its binding (tampered)");
  if (binding.approvalRecordVersion !== REVIEW_APPROVAL_RECORD_VERSION) reasons.push("unsupported approval record version");
  return reasons;
}
