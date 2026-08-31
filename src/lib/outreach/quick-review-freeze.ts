// ─────────────────────────────────────────────────────────────────────────────
// Freeze-at-approval orchestrator for the Quick Review PDF, plus the single fail-closed
// resolver every approved send path uses to obtain the frozen bytes (never re-rendering).
//
//   approveAndFreezeQuickReview() — at operator approval: build the review, render the PDF
//     EXACTLY ONCE, persist the immutable bytes (keyed per lead+version), and record an
//     append-only approval binding (version + content digest + frozen SHA + filename …).
//     A reapproval after substantive-content drift mints a NEW version + NEW artifact.
//
//   resolveFrozenReviewForSend() — at preview / authorization / download / send: load the
//     approved binding, recompute the current content digest and FAIL CLOSED on drift, load
//     the frozen bytes and FAIL CLOSED if missing or SHA-mismatched (tamper). Returns the
//     exact stored bytes + identity. No approved path ever re-renders the PDF.
//
// The content digest used for drift is computed from a brandless, bookingUrl-neutral review
// build (deterministic from lead + BI) so a logo re-fetch or a booking-link thread does not
// invalidate an approval; the FROZEN PDF is rendered with the real brand + booking link.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, getBusinessIntelligence, getSettings, appendAudit, auditForTarget } from "../repo";
import { nowIso } from "../store";
import { currentOperatorId } from "../auth";
import { buildQuickReview, resolveLeadBrand, quickReviewFilename, type QuickReview, type ResolvedBrand } from "./quick-review";
import { renderQuickReviewPdf } from "../pdf/render";
import type { BusinessProfile } from "../business-intelligence/types";
import type { Lead } from "../types";
import { REVIEW_APPROVED_ACTION, quickReviewApproved } from "./review-approval";
import {
  reviewContentDigest, reviewApprovalDigest, reviewBindingDriftReasons, reviewApprovalIntactReasons,
  REVIEW_APPROVAL_RECORD_VERSION, type ReviewApprovalBinding,
} from "./review-approval-binding";
import {
  storeFrozenReviewPdf, loadFrozenReviewPdf, sha256OfBase64, frozenReviewPdfKey, FROZEN_REVIEW_CONTENT_TYPE,
} from "./frozen-review-pdf";

/** Injectable seams so the freeze/resolve logic is unit-testable without a DB or a real renderer. */
export interface FreezeDeps {
  loadLead?: (leadId: string) => Promise<Lead | null>;
  loadProfile?: (leadId: string) => Promise<{ profile: BusinessProfile | null; observedAt: string | null }>;
  loadBrand?: (lead: Lead) => Promise<ResolvedBrand | null>;
  loadBookingUrl?: () => Promise<string | null>;
  render?: (review: QuickReview) => Promise<Buffer>;
  now?: () => string;
  actor?: () => string;
}

const defaults = {
  loadLead: (id: string) => getLead(id),
  loadProfile: async (id: string) => {
    const bi = await getBusinessIntelligence(id);
    return { profile: (bi?.profile?.businessProfile as BusinessProfile | undefined) ?? null, observedAt: bi?.generatedAt ?? null };
  },
  loadBrand: (lead: Lead) => resolveLeadBrand(lead),
  loadBookingUrl: async () => (await getSettings()).calendarLink ?? null,
  render: (review: QuickReview) => renderQuickReviewPdf(review, new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })),
  now: () => nowIso(),
  actor: () => currentOperatorId() ?? "operator",
};

/** Build the DRIFT-STABLE review (brandless, default booking link) whose digest fingerprints source
 *  content. Independent of logo resolution + booking-link threading, so those never force re-approval. */
function digestReview(lead: Lead, profile: BusinessProfile | null, observedAt: string | null): QuickReview {
  return buildQuickReview(lead, profile, null, { approved: true, observedAt, bookingUrl: null });
}

/** Read the newest recorded approval binding for a lead (append-only audit; latest by createdAt). */
export async function latestReviewApproval(leadId: string): Promise<{ binding: ReviewApprovalBinding; digest: string; approvedAt: string } | null> {
  const rows = await auditForTarget("lead", leadId);
  const approvals = rows
    .filter((r) => r.action === REVIEW_APPROVED_ACTION && r.meta && (r.meta as Record<string, unknown>).binding)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const latest = approvals[approvals.length - 1];
  if (!latest) return null;
  const meta = latest.meta as Record<string, unknown>;
  return { binding: meta.binding as ReviewApprovalBinding, digest: String(meta.approvalDigest ?? ""), approvedAt: latest.createdAt };
}

export interface ApproveFreezeResult {
  ok: boolean;
  version?: number;
  frozenPdfSha256?: string;
  filename?: string;
  digest?: string;
  idempotent?: boolean;
  blocked?: boolean;
  reason?: string;
}

/**
 * Operator approval: render the Quick Review PDF exactly once and freeze it, binding the exact bytes
 * to the approved content + version. Idempotent for identical content (returns the existing frozen
 * version); a substantive-content change mints a NEW version. INSUFFICIENT_EVIDENCE can never freeze.
 */
export async function approveAndFreezeQuickReview(input: { leadId: string }, deps: FreezeDeps = {}): Promise<ApproveFreezeResult> {
  const d = { ...defaults, ...deps };
  const lead = await d.loadLead(input.leadId);
  if (!lead) return { ok: false, blocked: true, reason: "Lead not found." };
  const { profile, observedAt } = await d.loadProfile(input.leadId);

  const digestRev = digestReview(lead, profile, observedAt);
  if (digestRev.status === "INSUFFICIENT_EVIDENCE") {
    return { ok: false, blocked: true, reason: "This review has no evidence-backed findings — it can't be approved. Re-run analysis to gather evidence." };
  }
  const contentDigest = reviewContentDigest(digestRev);

  // Idempotency + versioning: an existing approval with the SAME content is a no-op; drift ⇒ next version.
  const prior = await latestReviewApproval(input.leadId);
  if (prior && prior.binding.contentDigest === contentDigest) {
    return { ok: true, idempotent: true, version: prior.binding.reviewVersion, frozenPdfSha256: prior.binding.frozenPdfSha256, filename: prior.binding.filename, digest: prior.digest };
  }
  const version = (prior?.binding.reviewVersion ?? 0) + 1;

  // Render ONCE — with the real brand + booking link — then freeze the exact bytes.
  const brand = await d.loadBrand(lead);
  const bookingUrl = await d.loadBookingUrl();
  const renderRev = buildQuickReview(lead, profile, brand, { approved: true, observedAt, bookingUrl });
  if (!renderRev.ready) return { ok: false, blocked: true, reason: `Quick Review is not delivery-ready (status ${renderRev.status}).` };
  const pdf = await d.render(renderRev);
  const pdfBase64 = pdf.toString("base64");
  const frozenPdfSha256 = await storeFrozenReviewPdf(input.leadId, version, pdfBase64);
  const filename = quickReviewFilename(lead.businessName);

  const binding: ReviewApprovalBinding = {
    approvalRecordVersion: REVIEW_APPROVAL_RECORD_VERSION,
    leadId: input.leadId,
    reviewVersion: version,
    businessName: lead.businessName,
    reviewStatus: digestRev.status,
    contentDigest,
    frozenPdfSha256,
    byteSize: Buffer.from(pdfBase64, "base64").byteLength,
    filename,
    contentType: FROZEN_REVIEW_CONTENT_TYPE,
    blobKey: frozenReviewPdfKey(input.leadId, version),
    frozenAt: d.now(),
    approvedBy: d.actor(),
  };
  const digest = reviewApprovalDigest(binding);
  await appendAudit({ action: REVIEW_APPROVED_ACTION, actor: binding.approvedBy, targetType: "lead", targetId: input.leadId, meta: { status: digestRev.status, binding, approvalDigest: digest } as unknown as Record<string, unknown>, ip: null });
  return { ok: true, version, frozenPdfSha256, filename, digest };
}

export interface ResolvedFrozenReview {
  ok: boolean;
  pdfBase64?: string;
  sha256?: string;
  byteSize?: number;
  filename?: string;
  version?: number;
  binding?: ReviewApprovalBinding;
  blocked?: boolean;
  reason?: string;
}

/**
 * The SINGLE fail-closed resolver every approved send path uses. Loads the approved binding, verifies
 * it is intact + not drifted, loads the frozen bytes, and verifies their SHA matches the binding. On
 * ANY failure it returns { ok:false } with a precise reason — it NEVER renders a PDF.
 */
export async function resolveFrozenReviewForSend(leadId: string, deps: FreezeDeps = {}): Promise<ResolvedFrozenReview> {
  const d = { ...defaults, ...deps };
  const approval = await latestReviewApproval(leadId);
  if (!approval) return { ok: false, blocked: true, reason: "no frozen Quick Review approval (approve to freeze first)" };

  const intact = reviewApprovalIntactReasons(approval.binding, approval.digest);
  if (intact.length) return { ok: false, blocked: true, reason: `approval binding invalid: ${intact.join("; ")}` };

  const lead = await d.loadLead(leadId);
  if (!lead) return { ok: false, blocked: true, reason: "lead not found" };
  const { profile, observedAt } = await d.loadProfile(leadId);
  const currentDigest = reviewContentDigest(digestReview(lead, profile, observedAt));
  const drift = reviewBindingDriftReasons(approval.binding, { contentDigest: currentDigest, businessName: lead.businessName, reviewStatus: digestReview(lead, profile, observedAt).status });
  if (drift.length) return { ok: false, blocked: true, reason: `approval stale — ${drift.join("; ")} (re-approve to mint a new version)` };

  const frozen = await loadFrozenReviewPdf(leadId, approval.binding.reviewVersion);
  if (!frozen) return { ok: false, blocked: true, reason: "frozen Quick Review artifact missing (blob not found)" };
  if (frozen.sha256 !== approval.binding.frozenPdfSha256 || sha256OfBase64(frozen.pdfBase64) !== approval.binding.frozenPdfSha256) {
    return { ok: false, blocked: true, reason: "frozen artifact tampered (SHA mismatch)" };
  }
  return { ok: true, pdfBase64: frozen.pdfBase64, sha256: frozen.sha256, byteSize: frozen.byteSize, filename: approval.binding.filename, version: approval.binding.reviewVersion, binding: approval.binding };
}

/**
 * The single materialize-once resolver every SEND path uses. Behaviour:
 *   • a frozen artifact already exists (approved or previously materialized) → return it, NO render;
 *   • its source content has DRIFTED, or the bytes are missing/tampered → FAIL CLOSED (re-approve);
 *   • no artifact yet AND the review is delivery-ready WITHOUT operator approval (SENDABLE, or a
 *     NEEDS_REVIEW the operator approved through the legacy flag) → render EXACTLY ONCE and freeze it,
 *     then return those bytes. A NEEDS_REVIEW review with no approval, or INSUFFICIENT, fails closed.
 * This is the one place the PDF is ever rendered on the send path; every subsequent read reuses bytes.
 */
export async function ensureFrozenReviewForSend(leadId: string, deps: FreezeDeps = {}): Promise<ResolvedFrozenReview> {
  const existing = await resolveFrozenReviewForSend(leadId, deps);
  const prior = await latestReviewApproval(leadId);
  // A binding exists (drift / tamper / missing-bytes) → NEVER auto-materialize over it; fail closed.
  if (prior) return existing;
  if (existing.ok) return existing;

  // No approval binding yet — materialize once IFF the review is delivery-ready on its own terms.
  const d = { ...defaults, ...deps };
  const lead = await d.loadLead(leadId);
  if (!lead) return { ok: false, blocked: true, reason: "lead not found" };
  const { profile, observedAt } = await d.loadProfile(leadId);
  if (!profile) return { ok: false, blocked: true, reason: "no review profile" };

  const approvedFlag = await quickReviewApproved(leadId); // legacy operator approval of a NEEDS_REVIEW
  const brand = await d.loadBrand(lead);
  const bookingUrl = await d.loadBookingUrl();
  const renderRev = buildQuickReview(lead, profile, brand, { approved: approvedFlag, observedAt, bookingUrl });
  if (!renderRev.ready) return { ok: false, blocked: true, reason: "review not delivery-ready" };

  const contentDigest = reviewContentDigest(digestReview(lead, profile, observedAt));
  const version = 1;
  const pdf = await d.render(renderRev);
  const pdfBase64 = pdf.toString("base64");
  const frozenPdfSha256 = await storeFrozenReviewPdf(leadId, version, pdfBase64);
  const filename = quickReviewFilename(lead.businessName);
  const binding: ReviewApprovalBinding = {
    approvalRecordVersion: REVIEW_APPROVAL_RECORD_VERSION,
    leadId, reviewVersion: version, businessName: lead.businessName, reviewStatus: digestReview(lead, profile, observedAt).status,
    contentDigest, frozenPdfSha256, byteSize: Buffer.from(pdfBase64, "base64").byteLength,
    filename, contentType: FROZEN_REVIEW_CONTENT_TYPE, blobKey: frozenReviewPdfKey(leadId, version),
    frozenAt: d.now(), approvedBy: d.actor(),
  };
  const digest = reviewApprovalDigest(binding);
  await appendAudit({ action: REVIEW_APPROVED_ACTION, actor: binding.approvedBy, targetType: "lead", targetId: leadId, meta: { status: binding.reviewStatus, binding, approvalDigest: digest, materialized: true } as unknown as Record<string, unknown>, ip: null });
  return { ok: true, pdfBase64, sha256: frozenPdfSha256, byteSize: binding.byteSize, filename, version, binding };
}
