// ─────────────────────────────────────────────────────────────────────────────
// Frozen Prospect Sales Package — PERSISTENCE + ORCHESTRATION (the I/O layer over prospect-package.ts).
// Mirrors the proven frozen-review pattern: state lives in the append-only audit log keyed to the lead
// (latest record wins), so no new table/migration is required and history is preserved. Lifecycle:
//   assembleDraftPackage()  — at video READY (or email-only): build/refresh a DRAFT (no freeze)
//   freezeProspectPackage() — from Approve*: validate + bind + snapshot an immutable FROZEN version
//   markPackageState()      — SCHEDULED / SENT transitions (append-only)
//   revokePackageShare()    — immediate revocation checked by the /pv route
//   resolvePackageForSendById() — fail-closed pre-dispatch verification of every component
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { getLead, getBusinessIntelligence, appendAudit, auditForTarget } from "../repo";
import { nowIso } from "../store";
import { currentOperatorId } from "../auth";
import { buildQuickReview, cachedBrand } from "./quick-review";
import { quickReviewApproved } from "./review-approval";
import { resolveFrozenReviewForSend } from "./quick-review-freeze";
import { listJobs } from "../content-studio/store";
import { latestReadyJob } from "../content-studio/job";
import { getArtifactStore } from "../content-studio/storage-factory";
import type { BusinessProfile } from "../business-intelligence/types";
import {
  computePackageDigest, validateForFreeze, assessDraftReadiness, resolvePackageForSend,
  normalizeRecipient, PROSPECT_PACKAGE_RECORD_VERSION, currentShareKeyVersion,
  verifyPackageShare, envShareKeyResolver, buildPackageShareUrl, assertAttachmentsFitResend,
  type ProspectPackageDraft, type FrozenProspectPackage, type ProspectPackageState,
  type ReviewBinding, type VideoBinding, type EvidenceProvenance, type ShareIdentity,
} from "./prospect-package";

export const PROSPECT_PACKAGE_ACTION = "prospect.package";
export const PROSPECT_SHARE_REVOKED_ACTION = "prospect.package.share_revoked";
const pieceIdFor = (leadId: string) => `client-${leadId}`;

// ── Draft assembly (video READY or email-only) ───────────────────────────────────────────────────────
export interface AssembleDeps {
  loadLead?: typeof getLead;
  loadProfile?: (leadId: string) => Promise<BusinessProfile | null>;
  resolveReview?: (leadId: string) => Promise<{ ok: boolean; sha256?: string; byteSize?: number; filename?: string; version?: number; binding?: { blobKey: string } }>;
  loadVideo?: (leadId: string) => Promise<VideoBinding | null>;
  mintPublicId?: () => string;
  now?: () => string;
}
const defaults = {
  loadLead: getLead,
  loadProfile: async (leadId: string) => ((await getBusinessIntelligence(leadId))?.profile?.businessProfile as BusinessProfile | undefined) ?? null,
  resolveReview: (leadId: string) => resolveFrozenReviewForSend(leadId),
  loadVideo: async (leadId: string): Promise<VideoBinding | null> => {
    const ready = latestReadyJob(await listJobs(), pieceIdFor(leadId));
    if (!ready?.outputKey) return null;
    const meta = await getArtifactStore().getMeta(ready.outputKey).catch(() => null);
    if (!meta?.sha256) return null;
    return { jobId: ready.id, inputVersion: ready.inputVersion, videoKey: ready.outputKey, sha256: meta.sha256 };
  },
  mintPublicId: () => "pub_" + randomBytes(18).toString("hex"),
  now: () => nowIso(),
};

/** Build (or refresh) the DRAFT package for a lead. Never freezes. videoRequired=true when the lead's
 *  package includes a video (a video job exists or is expected); email-only leaves video/share null. */
export async function assembleDraftPackage(
  leadId: string,
  input: { subject: string; bodyHtml: string; bodyText: string; videoRequired: boolean },
  deps: AssembleDeps = {},
): Promise<{ draft: ProspectPackageDraft; state: "INCOMPLETE" | "READY_TO_APPROVE"; blockers: string[] }> {
  const d = { ...defaults, ...deps };
  const lead = await d.loadLead(leadId);
  const profile = await d.loadProfile(leadId);
  const prior = await latestProspectPackage(leadId);
  const packageVersion = prior ? prior.packageVersion : 1;

  const review = await d.resolveReview(leadId);
  const reviewBinding: ReviewBinding | null = review.ok && review.binding
    ? { reviewVersion: review.version!, blobKey: review.binding.blobKey, sha256: review.sha256!, byteSize: review.byteSize!, filename: review.filename! }
    : null;

  const video = input.videoRequired ? await d.loadVideo(leadId) : null;

  // Evidence provenance: the prospect-specific findings + a stable digest (the frozen review SHA fingerprints
  // the evidence-bearing artifact; findings come from the current review build).
  const evidence: EvidenceProvenance = { findingIds: [], digests: [] };
  if (profile && lead) {
    const rev = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(leadId) });
    evidence.findingIds = (rev.findings ?? []).map((f) => String(f.id));
    evidence.digests = [reviewBinding?.sha256 ?? "no-review", ...evidence.findingIds].filter(Boolean);
  }

  // Reuse the prior share identity if one exists at this version (stable "Copy link"); otherwise mint one
  // when the package has a video.
  let share: ShareIdentity | null = prior?.share ?? null;
  if (input.videoRequired && video && !share) {
    share = { publicId: d.mintPublicId(), shareVersion: 1, keyVersion: currentShareKeyVersion() };
  }

  const draft: ProspectPackageDraft = {
    leadId, packageVersion,
    recipientEmail: normalizeRecipient(lead?.publicEmail ?? ""),
    subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText,
    videoRequired: input.videoRequired, review: reviewBinding, video, evidence, share,
  };
  const readiness = assessDraftReadiness(draft);
  return { draft, state: readiness.state, blockers: readiness.blockers };
}

// ── Automatic post-render assembly (mandate: no Generate/Approve to REACH the draft) ──────────────────
/** Deterministic draft email copy (final body is regenerated by buildPackageEmail at send). */
export function draftEmailCopy(businessName: string): { bodyText: string; bodyHtml: string } {
  const who = businessName || "your business";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return {
    bodyText: `Hi,\n\nI put together a short, focused review for ${who} — the PDF is attached, and there's a 60-second video.\n\nIf it's useful, just reply.\n\n— Artifex Labs`,
    bodyHtml: `<div><p>Hi,</p><p>I put together a short, focused review for <strong>${esc(who)}</strong> — the PDF is attached, and there's a 60-second video.</p><p>If it's useful, just reply.</p><p>— Artifex Labs</p></div>`,
  };
}

export interface AutoAssembleResult { ok: boolean; state?: ProspectPackageState; packageVersion?: number; digest?: string; publicId?: string | null; inputVersion?: string; idempotent?: boolean; reason?: string; blockers?: string[]; }

/**
 * POST-RENDER HOOK: once a verified prospect MP4 is published, build + PERSIST a DRAFT package and move it
 * to READY_TO_APPROVE — WITHOUT freezing. Idempotent per render input version (duplicate completion events,
 * retries, and simultaneous callbacks converge to ONE draft per version). A NEWER render (different input
 * version) mints a fresh draft; a frozen package is never modified. Fails CLOSED (returns a specific reason,
 * for Needs attention) if any required component is missing/stale/unapproved. Never runs for Field Notes.
 */
export async function autoAssembleFromRender(leadId: string, deps: AssembleDeps = {}): Promise<AutoAssembleResult> {
  const d = { ...defaults, ...deps };
  const lead = await d.loadLead(leadId);
  if (!lead) return { ok: false, reason: "lead not found" };
  const video = await d.loadVideo(leadId);
  if (!video) return { ok: false, reason: "verified video not ready" };

  const prior = await latestProspectPackage(leadId);
  // Idempotency: a package already bound to THIS render's input version → no-op (don't touch a frozen pkg).
  if (prior && prior.video?.inputVersion === video.inputVersion && ["READY_TO_APPROVE", "FROZEN", "SCHEDULED", "SENT"].includes(prior.state)) {
    return { ok: true, idempotent: true, state: prior.state, packageVersion: prior.packageVersion, digest: prior.packageDigest, publicId: prior.share?.publicId ?? null, inputVersion: video.inputVersion };
  }
  // A frozen package for an OLDER version stays immutable; a new render supersedes it with a new draft.
  const subject = `Quick Review — ${lead.businessName}`;
  const copy = draftEmailCopy(lead.businessName);
  const { draft, state, blockers } = await assembleDraftPackage(leadId, { subject, bodyHtml: copy.bodyHtml, bodyText: copy.bodyText, videoRequired: true }, deps);
  if (state !== "READY_TO_APPROVE" || !draft.review) return { ok: false, reason: "package incomplete after render", blockers };

  // Persist the READY_TO_APPROVE draft with its content digest. frozenAt/approvedBy are the pre-freeze
  // sentinels; the digest (content-only) equals the eventual frozen digest for identical content.
  const record: FrozenProspectPackage = {
    ...draft, recordVersion: PROSPECT_PACKAGE_RECORD_VERSION, review: draft.review, share: draft.share,
    packageDigest: "", state: "READY_TO_APPROVE", frozenAt: "", approvedBy: "system-auto",
  };
  record.packageDigest = computePackageDigest(record);
  await appendAudit({ action: PROSPECT_PACKAGE_ACTION, actor: "system-auto", targetType: "lead", targetId: leadId, meta: { pkg: record } as unknown as Record<string, unknown>, ip: null });
  return { ok: true, state: "READY_TO_APPROVE", packageVersion: record.packageVersion, digest: record.packageDigest, publicId: record.share?.publicId ?? null, inputVersion: video.inputVersion };
}

/**
 * APP-SIDE GUARANTEE for post-render assembly: scan every prospect piece (client-*) that has a verified
 * READY render and ensure its DRAFT package is assembled (READY_TO_APPROVE). Idempotent per input version
 * (a package already bound to that render is a no-op), so it converges even if the worker's inline hook was
 * missed, retried, or fired twice. Runs on the materialize cron tick. Never touches Field Notes / frozen pkgs.
 */
export async function reconcileReadyProspectPackages(): Promise<{ scanned: number; assembled: Array<{ leadId: string; state: string }>; idempotent: number; failed: Array<{ leadId: string; reason: string }> }> {
  const jobs = await listJobs();
  const clientPieceIds = [...new Set(jobs.map((j) => j.pieceId).filter((p) => p.startsWith("client-")))];
  const out = { scanned: 0, assembled: [] as Array<{ leadId: string; state: string }>, idempotent: 0, failed: [] as Array<{ leadId: string; reason: string }> };
  for (const pieceId of clientPieceIds) {
    const ready = latestReadyJob(jobs, pieceId);
    if (!ready?.outputKey) continue; // no verified render yet
    out.scanned += 1;
    const leadId = pieceId.slice("client-".length);
    const r = await autoAssembleFromRender(leadId);
    if (!r.ok) out.failed.push({ leadId, reason: r.reason ?? "assembly failed" });
    else if (r.idempotent) out.idempotent += 1;
    else out.assembled.push({ leadId, state: r.state ?? "READY_TO_APPROVE" });
  }
  return out;
}

/**
 * Create/refresh the INCOMPLETE draft prospect package for a lead that is being prepared (pre-video):
 * binds the frozen review + evidence + (minted) share, persists it so the lead has a real draft record
 * "awaiting only voiceover/video". Idempotent: if a package for this review version already exists at a
 * non-frozen state it is a no-op; a frozen/scheduled/sent package is never touched. Never freezes/sends.
 */
export async function ensureDraftPackage(leadId: string, input: { subject: string; bodyHtml: string; bodyText: string }, deps: AssembleDeps = {}): Promise<{ ok: boolean; state?: ProspectPackageState; reason?: string; packageVersion?: number; created?: boolean }> {
  const { draft, state } = await assembleDraftPackage(leadId, { ...input, videoRequired: true }, deps);
  if (!draft.review) return { ok: false, reason: "review not frozen yet" };
  const prior = await latestProspectPackage(leadId);
  if (prior && ["FROZEN", "SCHEDULED", "SENT"].includes(prior.state)) return { ok: true, state: prior.state, packageVersion: prior.packageVersion, created: false };
  // Idempotent on identical review binding + no video yet (draft phase): don't churn duplicate rows.
  if (prior && prior.state === state && prior.review?.sha256 === draft.review.sha256 && !prior.video && !draft.video) return { ok: true, state: prior.state, packageVersion: prior.packageVersion, created: false };
  const record: FrozenProspectPackage = {
    ...draft, recordVersion: PROSPECT_PACKAGE_RECORD_VERSION, review: draft.review, share: draft.share,
    packageDigest: "", state, frozenAt: "", approvedBy: "system-prepare",
  };
  record.packageDigest = computePackageDigest(record);
  await appendAudit({ action: PROSPECT_PACKAGE_ACTION, actor: "system-prepare", targetType: "lead", targetId: leadId, meta: { pkg: record } as unknown as Record<string, unknown>, ip: null });
  return { ok: true, state, packageVersion: record.packageVersion, created: true };
}

// ── Freeze (from Approve*) ────────────────────────────────────────────────────────────────────────────
export interface FreezeResult { ok: boolean; packageVersion?: number; digest?: string; blocked?: boolean; reason?: string; idempotent?: boolean }

/** Freeze a draft into an immutable package version. Idempotent for identical content (same digest →
 *  returns the existing frozen version); any content change mints packageVersion+1. Only call from an
 *  Approve action. */
export async function freezeProspectPackage(
  leadId: string,
  input: { subject: string; bodyHtml: string; bodyText: string; videoRequired: boolean },
  deps: AssembleDeps = {},
): Promise<FreezeResult> {
  const d = { ...defaults, ...deps };
  const { draft } = await assembleDraftPackage(leadId, input, deps);
  const valid = validateForFreeze(draft);
  if (!valid.ok) return { ok: false, blocked: true, reason: valid.reason };

  const prior = await latestProspectPackage(leadId);
  // Idempotency: an existing FROZEN+ package with the SAME digest is a no-op.
  if (prior && (prior.state === "FROZEN" || prior.state === "SCHEDULED" || prior.state === "SENT") && prior.packageDigest === valid.digest) {
    return { ok: true, idempotent: true, packageVersion: prior.packageVersion, digest: prior.packageDigest };
  }
  const packageVersion = prior ? prior.packageVersion + (prior.state === "INCOMPLETE" || prior.state === "READY_TO_APPROVE" ? 0 : 1) : 1;
  const frozen: FrozenProspectPackage = {
    ...draft, packageVersion, recordVersion: PROSPECT_PACKAGE_RECORD_VERSION,
    review: draft.review!, share: draft.share,
    packageDigest: "", state: "FROZEN", frozenAt: d.now(), approvedBy: currentOperatorId() ?? "operator",
  };
  frozen.packageDigest = computePackageDigest(frozen);
  await appendAudit({ action: PROSPECT_PACKAGE_ACTION, actor: frozen.approvedBy, targetType: "lead", targetId: leadId, meta: { pkg: frozen } as unknown as Record<string, unknown>, ip: null });
  return { ok: true, packageVersion: frozen.packageVersion, digest: frozen.packageDigest };
}

/** The newest persisted package record for a lead (draft or frozen), or null. */
export async function latestProspectPackage(leadId: string): Promise<FrozenProspectPackage | null> {
  const rows = (await auditForTarget("lead", leadId))
    .filter((r) => r.action === PROSPECT_PACKAGE_ACTION && (r.meta as Record<string, unknown>)?.pkg)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const latest = rows[rows.length - 1];
  return latest ? ((latest.meta as Record<string, unknown>).pkg as FrozenProspectPackage) : null;
}

/** Append a lifecycle transition (SCHEDULED / SENT), preserving the immutable frozen content. */
export async function markPackageState(leadId: string, state: Extract<ProspectPackageState, "SCHEDULED" | "SENT">): Promise<boolean> {
  const cur = await latestProspectPackage(leadId);
  if (!cur) return false;
  const next: FrozenProspectPackage = { ...cur, state };
  await appendAudit({ action: PROSPECT_PACKAGE_ACTION, actor: currentOperatorId() ?? "operator", targetType: "lead", targetId: leadId, meta: { pkg: next } as unknown as Record<string, unknown>, ip: null });
  return true;
}

// ── Share revocation (checked by the /pv route) ───────────────────────────────────────────────────────
export async function revokePackageShare(leadId: string, publicId: string): Promise<boolean> {
  await appendAudit({ action: PROSPECT_SHARE_REVOKED_ACTION, actor: currentOperatorId() ?? "operator", targetType: "lead", targetId: leadId, meta: { publicId, at: nowIso() } as unknown as Record<string, unknown>, ip: null });
  return true;
}
export async function isShareRevoked(leadId: string, publicId: string): Promise<boolean> {
  const rows = await auditForTarget("lead", leadId);
  return rows.some((r) => r.action === PROSPECT_SHARE_REVOKED_ACTION && (r.meta as Record<string, unknown>)?.publicId === publicId);
}

// ── Public recipient-link resolution (the /pv route) ──────────────────────────────────────────────────
export interface PublicShareResult { ok: boolean; status: number; reason?: string; videoKey?: string; businessName?: string | null; posterKey?: string | null }
/** Resolve a public /pv request: load the package by packageId(=leadId), confirm the publicId matches,
 *  verify the signature (constant-time, key-version aware), then check DB revocation + package state +
 *  version. Returns the videoKey to stream on success. Never exposes anything on any failure. */
export async function resolvePublicShare(input: { publicId: string; packageId: string; packageVersion: number; keyVersion: number; sig: string }): Promise<PublicShareResult> {
  const leadId = input.packageId;
  const pkg = await latestProspectPackage(leadId);
  if (!pkg || !pkg.share || !pkg.video) return { ok: false, status: 404, reason: "not found" };
  if (pkg.share.publicId !== input.publicId) return { ok: false, status: 404, reason: "not found" };
  const v = verifyPackageShare(
    { packageId: leadId, publicId: input.publicId, packageVersion: input.packageVersion, shareVersion: pkg.share.shareVersion, keyVersion: input.keyVersion, sig: input.sig },
    envShareKeyResolver(),
  );
  if (!v.ok) return { ok: false, status: 403, reason: "invalid link" };
  if (input.packageVersion !== pkg.packageVersion) return { ok: false, status: 410, reason: "superseded" };
  if (await isShareRevoked(leadId, input.publicId)) return { ok: false, status: 410, reason: "revoked" };
  if (pkg.state !== "FROZEN" && pkg.state !== "SCHEDULED" && pkg.state !== "SENT") return { ok: false, status: 404, reason: "not ready" };
  return { ok: true, status: 200, videoKey: pkg.video.videoKey, businessName: pkg.video ? (await getLead(leadId))?.businessName ?? null : null };
}

/** Build the stable recipient URL for previews / Copy link / dispatch (server-side; null if unsigned). */
export function packageShareUrl(pkg: FrozenProspectPackage, baseUrl: string): string | null {
  if (!pkg.share) return null;
  return buildPackageShareUrl(baseUrl, pkg.leadId, pkg.packageVersion, pkg.share, envShareKeyResolver());
}

// ── Package-aware outbound email (frozen PDF attachment + signed video CTA) ───────────────────────────
export interface PackageEmail {
  subject: string; text: string; html: string; viewUrl: string | null;
  attachment: { filename: string; pdfBase64: string; sha256: string } | null;
  sizeGuard: { ok: boolean; encodedBytes: number; reason?: string };
}
/** Build the outbound email bound to the frozen package version: the frozen Quick Review PDF is ATTACHED,
 *  the finished sales video is a LINKED CTA (never attached). Fails the size guard before Resend if the
 *  base64 attachment total would exceed the provider limit. */
export async function buildPackageEmail(leadId: string, opts: { baseUrl: string; recipientName?: string | null }): Promise<{ ok: boolean; reason?: string; email?: PackageEmail; pkg?: FrozenProspectPackage }> {
  const pkg = await latestProspectPackage(leadId);
  if (!pkg) return { ok: false, reason: "no package" };
  const lead = await getLead(leadId);
  const who = lead?.businessName || "your business";
  const review = await resolveFrozenReviewForSend(leadId);
  const attachment = review.ok && review.pdfBase64
    ? { filename: review.filename || "Quick-Review.pdf", pdfBase64: review.pdfBase64, sha256: review.sha256! }
    : null;
  const viewUrl = packageShareUrl(pkg, opts.baseUrl);

  // Size guard: only the PDF is attached; the MP4 is a link. Raw bytes = base64 length × 3/4.
  const rawPdf = attachment ? Math.floor((attachment.pdfBase64.length * 3) / 4) : 0;
  const guard = assertAttachmentsFitResend([rawPdf]);

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const name = opts.recipientName ? " " + opts.recipientName : "";
  const cta = viewUrl ? `\n\nWatch your short video review: ${viewUrl}` : "";
  const text = `Hi${name},\n\nI put together a short, focused review for ${who} — the PDF is attached${viewUrl ? ", and there's a 60-second video" : ""}.${cta}\n\nIf it's useful, just reply to this email.\n\n— Artifex Labs`;
  const htmlCta = viewUrl ? `<p><a href="${viewUrl}" style="color:#2c5ac4;font-weight:bold">▶ Watch your video review</a></p>` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0C1220;font-size:15px;line-height:1.5"><p>Hi${esc(name)},</p><p>I put together a short, focused review for <strong>${esc(who)}</strong> — the PDF is attached${viewUrl ? ", and there's a 60-second video" : ""}.</p>${htmlCta}<p>If it's useful, just reply to this email.</p><p style="color:#5A6B85;font-size:13px">— Artifex Labs</p></div>`;

  const subject = pkg.subject || `A short review for ${who}`;
  return { ok: guard.ok, reason: guard.ok ? undefined : guard.reason, pkg, email: { subject, text, html, viewUrl, attachment, sizeGuard: guard } };
}

// ── Fail-closed pre-dispatch resolution ───────────────────────────────────────────────────────────────
export async function resolvePackageForSendById(leadId: string): Promise<{ ok: boolean; reason?: string; pkg?: FrozenProspectPackage }> {
  const pkg = await latestProspectPackage(leadId);
  if (!pkg) return { ok: false, reason: "no frozen package (approve to freeze first)" };
  // FAIL-CLOSED integrity gate (mandate 16/17/20): placeholder/test CONTENT never dispatches. Test-PROVENANCE
  // is rejected in PRODUCTION but ALLOWED inside the isolated Breakbot tenant (flag never set in production).
  const { detectPlaceholderContent, testProvenanceReason } = await import("./dispatch-integrity");
  const guardLead = await getLead(leadId);
  if (process.env.BREAKBOT_TEST_TENANT !== "1") {
    const { isInternalLead } = await import("../operators/assignment");
    const tp = testProvenanceReason(guardLead as { source?: string | null; businessName?: string | null; test_only?: boolean } | null, { internal: guardLead ? isInternalLead(guardLead) : false });
    if (tp) return { ok: false, reason: `TEST_PROVENANCE: ${tp}`, pkg };
  }
  const ph = detectPlaceholderContent({ subject: pkg.subject, body: pkg.bodyText || pkg.bodyHtml, businessName: guardLead?.businessName });
  if (ph) return { ok: false, reason: `PLACEHOLDER_OR_TEST_CONTENT: ${ph}`, pkg };
  const review = await resolveFrozenReviewForSend(leadId);
  const currentReviewSha = review.ok ? review.sha256 ?? null : null;
  let currentVideoSha: string | null = null;
  if (pkg.video) currentVideoSha = (await getArtifactStore().getMeta(pkg.video.videoKey).catch(() => null))?.sha256 ?? null;
  const shareRevoked = pkg.share ? await isShareRevoked(leadId, pkg.share.publicId) : false;
  const verdict = resolvePackageForSend({ pkg, currentReviewSha, currentVideoSha, shareRevoked });
  return { ok: verdict.ok, reason: verdict.reason, pkg };
}
