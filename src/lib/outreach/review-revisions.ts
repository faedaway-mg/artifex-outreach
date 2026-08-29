// ─────────────────────────────────────────────────────────────────────────────
// Quick Review — operator editing, versioning, and VERSION-BOUND approval (M2).
//
// The M1 gate proved a review can be editorially clean. M2 adds the operator's ability to
// REVISE the presentation copy and — critically — makes approval bind to the EXACT content it
// approved. Approval is a FINGERPRINT of the effective, customer-facing review (overlay applied)
// plus its evidence digest plus the renderer/template version. Any later change to the copy, the
// evidence, or the template changes the fingerprint, which silently invalidates the prior
// approval, its preview, and delivery-readiness. The send paths ship ONLY the exact approved
// revision — never a stale one, and never a bare email in its place.
//
// Evidence is PROTECTED: the overlay overrides presentation TEXT only; the source records,
// metrics, URLs, capture dates, and observation classifications are never editable here, and an
// edit that introduces an unsupported numeric claim or an unscoped absence claim blocks approval.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import { buildQuickReview, type QuickReview, type ResolvedBrand } from "./quick-review";
import { checkReview, editorialBlocks, reviewEditorialSurface, type EditorialIssue } from "./editorial-quality";
import { getBusinessIntelligence, getLead, appendAudit, commitReviewEditorial, getSettings } from "../repo";
import type { AuditEntry } from "../types";
import { currentActor } from "../auth";

/** The renderer/template contract version. Bump when the PDF layout or field semantics change so
 *  a prior approval (bound to the old template) can never silently render on a new one. */
export const TEMPLATE_VERSION = "qr-m3-cta-1";

// ── Overlay: operator-authored PRESENTATION overrides. Evidence is never here. ──────────────────
export interface FindingOverlay {
  title?: string;
  whyItMatters?: string;
  whatWedDo?: string;
  textHook?: string;
}
export interface ReviewOverlay {
  openingHook?: string | null;
  categoryLabel?: string | null;
  findings?: Record<string, FindingOverlay>;
  start?: { label?: string; why?: string };
  closingLine?: string | null;
}

export interface Revision {
  id: string; // = fingerprint of the effective review at save time
  overlay: ReviewOverlay;
  editedBy: string;
  editedAt: string;
}
export interface ApprovalBinding {
  revisionId: string;
  approvedBy: string;
  approvedAt: string;
}
export interface HeldState {
  reason: string;
  by: string;
  at: string;
}
/** A one-time SCHEDULED-SEND authorization — DISTINCT from review approval. Binds the exact package
 *  (recipient + content + evidence + PDF bytes + template + CTA) to a batch + a staggered send time,
 *  so the runner can re-verify and refuse on ANY drift. Persisted in the jsonb editorial state (no
 *  migration), CAS-guarded by `rev`. Never manufactures a review-approval record. */
export interface ScheduledBinding {
  batchId: string;
  revisionId: string;
  evidenceDigest: string;
  pdfSha256: string;
  templateVersion: string;
  ctaUrl: string | null;
  recipient: string;
  subject: string;
  bodyDigest: string;
  scheduledAt: string;      // assigned staggered instant (ISO, within the LA morning window)
  windowTz: string;
  by: string;
  at: string;
  status: "scheduled" | "cancelled" | "sent" | "held" | "delivery-blocked";
}
export interface ReviewEditorialState {
  draft: ReviewOverlay;
  history: Revision[];
  previewedRevisionId: string | null;
  checkedRevisionId: string | null;
  approval: ApprovalBinding | null;
  /** Operator "skip / hold unsent" — excluded from delivery without deleting the prospect. */
  held: HeldState | null;
  /** One-time scheduled-send authorization (distinct from approval). Null until the operator schedules. */
  scheduled?: ScheduledBinding | null;
  /** Monotonic storage version for DB-level compare-and-swap (Gate 6). Every persisted mutation
   *  bumps it; a write only lands if the stored rev still equals the rev the caller read. Distinct
   *  from the CONTENT fingerprint (`revisionId`) — preview/approve bump rev without changing content. */
  rev: number;
}

export const EMPTY_STATE: ReviewEditorialState = { draft: {}, history: [], previewedRevisionId: null, checkedRevisionId: null, approval: null, held: null, scheduled: null, rev: 0 };

// ── Audit actions ───────────────────────────────────────────────────────────────────────────
export const A = {
  saved: "quick-review.revision.saved",
  previewed: "quick-review.revision.previewed",
  checked: "quick-review.revision.checked",
  approved: "quick-review.revision.approved",
  regenProposed: "quick-review.regen.proposed",
  regenAccepted: "quick-review.regen.accepted",
  regenRejected: "quick-review.regen.rejected",
  regenFailed: "quick-review.regen.failed",
  overridden: "quick-review.editorial.overridden",
  held: "quick-review.held",
  revisited: "quick-review.revisited",
} as const;

// ── Apply overlay: PRESENTATION-only override of an assembled review. Evidence untouched. ───────
export function applyOverlay(review: QuickReview, overlay: ReviewOverlay | null | undefined): QuickReview {
  if (!overlay) return review;
  const fo = overlay.findings ?? {};
  const findings = review.findings.map((f) => {
    const o = fo[f.id];
    if (!o) return f;
    return {
      ...f,
      title: o.title ?? f.title,
      whyItMatters: o.whyItMatters ?? f.whyItMatters,
      whatWedDo: o.whatWedDo ?? f.whatWedDo,
      // evidence, id, topic, category, score, observation are NEVER overridden.
    };
  });
  const presentations = review.presentations.map((p) => {
    const o = fo[p.findingId];
    const f = findings.find((x) => x.id === p.findingId);
    return { ...p, title: f?.title ?? p.title, textHook: o?.textHook ?? p.textHook };
  });
  const start = review.start
    ? { ...review.start, label: overlay.start?.label ?? review.start.label, why: overlay.start?.why ?? review.start.why }
    : null;
  return {
    ...review,
    industryLabel: overlay.categoryLabel ?? review.industryLabel,
    openingHook: overlay.openingHook ?? review.openingHook,
    findings,
    presentations,
    start,
    observations: findings.map((f) => f.observation),
    whyItMatters: findings[0]?.whyItMatters || review.whyItMatters,
    recommendations: findings.map((f) => f.whatWedDo).filter(Boolean),
  };
}

/** A stable fingerprint of the EFFECTIVE review: its customer-facing surface + an evidence digest
 *  (so an evidence change invalidates approval) + the template version. Deterministic. */
export function revisionFingerprint(review: QuickReview): string {
  const surface = reviewEditorialSurface({
    businessName: review.businessName,
    website: review.website,
    industryLabel: review.industryLabel,
    openingHook: review.openingHook,
    findings: review.findings,
    presentations: review.presentations,
    start: review.start,
  }).map((s) => `${s.section}:${s.role}=${s.text}`);
  const evidence = review.findings.map((f) => ({
    id: f.id, obs: f.observation, conf: f.evidence.confidence, src: f.evidence.sourceUrl,
    basis: f.evidence.basis, at: f.evidence.observedAt, label: f.evidence.displayLabel,
  }));
  // The CTA destination is part of the customer-facing artifact: a change to the booking URL (or its
  // presence) must invalidate a prior approval/authorization bound to the old destination.
  const cta = review.cta ? { url: review.cta.bookingUrl, label: review.cta.buttonLabel } : null;
  const canonical = JSON.stringify({ template: TEMPLATE_VERSION, category: review.industryLabel, surface, evidence, cta, status: review.status });
  return "rev_" + createHash("sha256").update(canonical).digest("hex").slice(0, 20);
}

// ── Evidence protection: an edited claim must stay within the finding's evidence ─────────────────
export interface EvidenceProblem {
  findingId: string | null;
  field: string;
  kind: "unsupported-number" | "unscoped-absence";
  detail: string;
}

const NUM_RX = /\b\d[\d,]*(?:\.\d+)?\+?\b/g;
// Absolute absence phrasing that overstates a crawl-scoped observation into a fact about the world.
const ABSOLUTE_ABSENCE_RX = /\b(?:does\s?n['’]?t|do(?:es)?\s+not|did\s?n['’]?t|did\s+not)\s+(?:exist|have|offer|show|include)|\b(?:has|have|had|there\s+(?:is|are|were))\s+no\b|\bnever\b|\bno\s+\w+(?:\s+\w+)?\s+(?:at\s+all|whatsoever|exist)/i;
// Scoping that makes an absence claim honest (bound to what we inspected).
const SCOPED_ABSENCE_RX = /\b(crawl|crawled|on the pages|pages we|we (?:found|saw|checked|inspected)|surfaced|visible|on the site|on the homepage|in (?:the )?(?:review|our) (?:of|scan)|not (?:found|surfaced|shown|present) (?:on|in))/i;

function digitsOf(s: string): string[] {
  return (s.match(NUM_RX) ?? []).map((n) => n.replace(/[,+]/g, ""));
}

/** Validate that overlay text introduces no claim the finding's evidence can't support. Pure. */
export function validateOverlayClaims(baseReview: QuickReview, overlay: ReviewOverlay): EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];
  const fo = overlay.findings ?? {};
  const checkText = (findingId: string | null, field: string, text: string | undefined, evidenceHaystack: string) => {
    if (!text) return;
    // 1) Unsupported numbers: every number in the edited copy must appear in the finding's evidence.
    const allowed = new Set(digitsOf(evidenceHaystack));
    for (const n of digitsOf(text)) {
      if (!allowed.has(n)) problems.push({ findingId, field, kind: "unsupported-number", detail: `"${n}" is not in the finding's evidence` });
    }
    // 2) Absolute absence claims must be scoped to what was inspected.
    if (ABSOLUTE_ABSENCE_RX.test(text) && !SCOPED_ABSENCE_RX.test(text)) {
      problems.push({ findingId, field, kind: "unscoped-absence", detail: `absence claim must be scoped to the crawled pages: "${text.slice(0, 60)}"` });
    }
  };
  for (const f of baseReview.findings) {
    const o = fo[f.id];
    if (!o) continue;
    const hay = `${f.observation} ${f.evidence.basis.join(" ")} ${f.evidence.displayLabel}`;
    checkText(f.id, "title", o.title, hay);
    checkText(f.id, "whyItMatters", o.whyItMatters, hay);
    checkText(f.id, "whatWedDo", o.whatWedDo, hay);
    checkText(f.id, "textHook", o.textHook, hay);
  }
  // Hook + start reference the whole review's evidence pool.
  const pool = baseReview.findings.map((f) => `${f.observation} ${f.evidence.basis.join(" ")} ${f.evidence.displayLabel}`).join(" ");
  checkText(null, "openingHook", overlay.openingHook ?? undefined, pool);
  checkText(null, "start.why", overlay.start?.why, pool);
  return problems;
}

// ── Persistence on the BI jsonb (no migration; mock-store compatible) ───────────────────────────
type BIProfileWithEditorial = BusinessProfile & { reviewEditorial?: ReviewEditorialState };

export async function getEditorialState(leadId: string): Promise<ReviewEditorialState> {
  const bi = await getBusinessIntelligence(leadId);
  const bp = bi?.profile?.businessProfile as BIProfileWithEditorial | undefined;
  return bp?.reviewEditorial ? { ...EMPTY_STATE, ...bp.reviewEditorial, rev: bp.reviewEditorial.rev ?? 0 } : { ...EMPTY_STATE };
}

/** Persist a mutation of the editorial state atomically against the rev the caller read, recording
 *  its audit event in the SAME transaction. `prev` is the state read at the start of the operation;
 *  `next` is the new state MINUS its rev (this helper stamps rev = prev.rev + 1). Returns a conflict
 *  when another writer moved the rev first — the caller must surface a reload-and-retry to the operator
 *  and MUST NOT report the operation as successful. */
type NextState = Omit<ReviewEditorialState, "rev">;
async function commitState(
  leadId: string,
  prev: ReviewEditorialState,
  next: NextState,
  audit: Omit<AuditEntry, "id" | "createdAt">,
): Promise<{ ok: boolean; conflict: boolean }> {
  const expectedRev = prev.rev ?? 0;
  const nextEditorial: ReviewEditorialState = { ...next, rev: expectedRev + 1 };
  return commitReviewEditorial({ leadId, expectedRev, nextEditorial, audit });
}
const STALE_MSG = "the review changed since you loaded it — reload and reapply";

/** The canonical scheduling destination the send artifacts (PDF + email) share. Reading settings so
 *  an operator-configured calendarLink flows into BOTH surfaces and into the fingerprint — a change
 *  invalidates any prior approval bound to the old destination. Defaults heal to the identity URL. */
export async function resolveBookingUrl(): Promise<string> {
  const settings = await getSettings();
  return settings.calendarLink;
}

// ── Build the EFFECTIVE (overlay-applied) review for a lead ─────────────────────────────────────
export async function effectiveReviewFor(leadId: string, opts: { brand?: ResolvedBrand | null } = {}): Promise<{ lead: Lead; review: QuickReview; state: ReviewEditorialState } | null> {
  const lead = await getLead(leadId);
  if (!lead) return null;
  const bi = await getBusinessIntelligence(leadId);
  const profile = (bi?.profile?.businessProfile as BusinessProfile) ?? null;
  const state = await getEditorialState(leadId);
  const bookingUrl = await resolveBookingUrl();
  const base = buildQuickReview(lead, profile, opts.brand ?? null, { approved: true, observedAt: bi?.generatedAt ?? null, bookingUrl });
  const review = applyOverlay(base, state.draft);
  return { lead, review, state };
}

// ── Delivery-readiness: every condition bound to the CURRENT revision fingerprint ───────────────
export interface DeliveryReadiness {
  ready: boolean;
  revisionId: string;
  reasons: string[]; // why NOT ready (empty when ready)
  checks: {
    eligible: boolean;
    evidenceSatisfied: boolean;
    requiredFieldsComplete: boolean;
    editorialPasses: boolean;
    renderable: boolean;
    previewedCurrent: boolean;
    approvedCurrent: boolean;
  };
}

/** Assess delivery-readiness for the CURRENT effective revision. Pure over supplied inputs so it is
 *  trivially testable; the async wrapper `deliveryReadiness` loads state and calls this. */
export function assessReadiness(input: {
  review: QuickReview;
  state: ReviewEditorialState;
  leadEligible: boolean;
}): DeliveryReadiness {
  const { review, state } = input;
  const revisionId = revisionFingerprint(review);
  const editorialIssues = checkReview(review);
  const evidenceProblems = validateOverlayClaims(review, state.draft);
  const requiredFieldsComplete = Boolean(review.openingHook && review.findings.length > 0 && review.findings.every((f) => f.title && f.whyItMatters && f.whatWedDo) && review.start?.label && review.start?.why);
  const checks = {
    eligible: input.leadEligible,
    evidenceSatisfied: review.status !== "INSUFFICIENT_EVIDENCE" && evidenceProblems.length === 0,
    requiredFieldsComplete,
    editorialPasses: editorialBlocks(editorialIssues).length === 0,
    renderable: review.findings.length > 0, // render requires ≥1 finding (renderer contract)
    previewedCurrent: state.previewedRevisionId === revisionId,
    approvedCurrent: state.approval?.revisionId === revisionId,
  };
  const reasons: string[] = [];
  if (!checks.eligible) reasons.push("lead is no longer eligible");
  if (!checks.evidenceSatisfied) reasons.push(evidenceProblems.length ? `unsupported edited claim (${evidenceProblems[0].kind})` : "insufficient evidence");
  if (!checks.requiredFieldsComplete) reasons.push("a required customer-facing field is empty");
  if (!checks.editorialPasses) reasons.push("unresolved blocking editorial finding");
  if (!checks.renderable) reasons.push("nothing to render");
  if (!checks.previewedCurrent) reasons.push("current revision has not been previewed");
  if (!checks.approvedCurrent) reasons.push("current revision is not approved");
  return { ready: reasons.length === 0, revisionId, reasons, checks };
}

async function leadIsEligible(lead: Lead): Promise<boolean> {
  const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);
  return !TERMINAL.has(lead.pipelineStage) && (lead as any).acquisitionStrategy !== "Do Not Contact";
}

export async function deliveryReadiness(leadId: string): Promise<DeliveryReadiness | null> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return null;
  return assessReadiness({ review: eff.review, state: eff.state, leadEligible: await leadIsEligible(eff.lead) });
}

// ── Operator actions (server actions call these; role decisions passed in for testability) ──────
export async function saveDraft(leadId: string, overlay: ReviewOverlay, opts: { expectedBaseRevisionId?: string | null; actor?: string } = {}): Promise<{ ok: boolean; reason?: string; revisionId?: string; evidenceProblems?: EvidenceProblem[] }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "lead or review not found" };
  const currentId = revisionFingerprint(eff.review);
  // Optimistic concurrency: reject a save built on a stale base (someone edited since).
  if (opts.expectedBaseRevisionId && opts.expectedBaseRevisionId !== currentId) {
    return { ok: false, reason: "your edits are based on an older version — reload and reapply" };
  }
  const actor = opts.actor ?? currentActor();
  const state = eff.state;
  const biNow = await getBusinessIntelligence(leadId);
  const base = buildQuickReview(eff.lead, biNow?.profile?.businessProfile as BusinessProfile ?? null, null, { approved: true, observedAt: biNow?.generatedAt ?? null, bookingUrl: await resolveBookingUrl() });
  const merged: ReviewOverlay = mergeOverlay(state.draft, overlay);
  const nextReview = applyOverlay(base, merged);
  const newId = revisionFingerprint(nextReview);
  const evidenceProblems = validateOverlayClaims(base, merged);
  const next: NextState = {
    draft: merged,
    history: [...state.history, { id: newId, overlay: merged, editedBy: actor, editedAt: nowIso() }].slice(-50),
    // ANY content change invalidates preview, check, and approval bound to the old revision.
    previewedRevisionId: null,
    checkedRevisionId: null,
    approval: null,
    held: state.held ?? null, // editing a held review keeps it held until explicitly revisited
  };
  const c = await commitState(leadId, state, next, { action: A.saved, actor, targetType: "lead", targetId: leadId, meta: { revisionId: newId, priorRevisionId: currentId, fields: changedFields(overlay), evidenceProblems: evidenceProblems.length }, ip: null });
  if (!c.ok) return { ok: false, reason: c.conflict ? STALE_MSG : "no review on file to save" };
  return { ok: true, revisionId: newId, evidenceProblems };
}

export async function recordPreview(leadId: string, opts: { actor?: string } = {}): Promise<{ ok: boolean; revisionId?: string }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false };
  const revisionId = revisionFingerprint(eff.review);
  const { rev: _r, ...prevNoRev } = eff.state;
  const c = await commitState(leadId, eff.state, { ...prevNoRev, previewedRevisionId: revisionId }, { action: A.previewed, actor: opts.actor ?? currentActor(), targetType: "lead", targetId: leadId, meta: { revisionId }, ip: null });
  if (!c.ok) return { ok: false };
  return { ok: true, revisionId };
}

export async function runEditorialCheck(leadId: string, opts: { actor?: string } = {}): Promise<{ ok: boolean; revisionId?: string; issues?: EditorialIssue[]; evidenceProblems?: EvidenceProblem[] }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false };
  const revisionId = revisionFingerprint(eff.review);
  const issues = checkReview(eff.review);
  const biNow = await getBusinessIntelligence(leadId);
  const base = buildQuickReview(eff.lead, biNow?.profile?.businessProfile as BusinessProfile ?? null, null, { approved: true, observedAt: biNow?.generatedAt ?? null, bookingUrl: await resolveBookingUrl() });
  const evidenceProblems = validateOverlayClaims(base, eff.state.draft);
  const { rev: _r, ...prevNoRev } = eff.state;
  const c = await commitState(leadId, eff.state, { ...prevNoRev, checkedRevisionId: revisionId }, { action: A.checked, actor: opts.actor ?? currentActor(), targetType: "lead", targetId: leadId, meta: { revisionId, blocks: editorialBlocks(issues).length, evidenceProblems: evidenceProblems.length }, ip: null });
  if (!c.ok) return { ok: false };
  return { ok: true, revisionId, issues, evidenceProblems };
}

export async function approveRevision(leadId: string, opts: { authorized: boolean; actor?: string; expectedRevisionId?: string }): Promise<{ ok: boolean; reason?: string; revisionId?: string }> {
  if (!opts.authorized) return { ok: false, reason: "you don't have permission to approve reviews" };
  const readiness = await deliveryReadiness(leadId);
  if (!readiness) return { ok: false, reason: "lead or review not found" };
  const revisionId = readiness.revisionId;
  if (opts.expectedRevisionId && opts.expectedRevisionId !== revisionId) return { ok: false, reason: "the review changed since you opened it — reload and re-check" };
  // Approval requires everything EXCEPT the approval itself to hold for THIS revision.
  const c = readiness.checks;
  if (!c.evidenceSatisfied) return { ok: false, reason: "unsupported or insufficient evidence — cannot approve" };
  if (!c.editorialPasses) return { ok: false, reason: "resolve the blocking editorial finding first" };
  if (!c.requiredFieldsComplete) return { ok: false, reason: "complete the required fields first" };
  if (!c.previewedCurrent) return { ok: false, reason: "open the current preview before approving" };
  const actor = opts.actor ?? currentActor();
  const eff = await effectiveReviewFor(leadId);
  const { rev: _r, ...prevNoRev } = eff!.state;
  // Approval state + its audit event commit in ONE transaction: we never report approval success
  // when its durable audit record would be lost, and a concurrent writer cannot approve a moved rev.
  const committed = await commitState(leadId, eff!.state, { ...prevNoRev, approval: { revisionId, approvedBy: actor, approvedAt: nowIso() } }, { action: A.approved, actor, targetType: "lead", targetId: leadId, meta: { revisionId }, ip: null });
  if (!committed.ok) return { ok: false, reason: committed.conflict ? STALE_MSG : "lead or review not found" };
  return { ok: true, revisionId };
}

/** The ONLY entry point a send path may use to obtain a sendable review. Ships exactly the approved
 *  revision or nothing — never a stale revision, never a bare send. */
export async function reviewForSend(leadId: string): Promise<{ review: QuickReview | null; ready: boolean; reason?: string; revisionId?: string }> {
  const readiness = await deliveryReadiness(leadId);
  if (!readiness) return { review: null, ready: false, reason: "no review" };
  if (!readiness.ready) return { review: null, ready: false, reason: readiness.reasons[0], revisionId: readiness.revisionId };
  const eff = await effectiveReviewFor(leadId);
  return { review: eff!.review, ready: true, revisionId: readiness.revisionId };
}

// ── Targeted regeneration (production adapter in review-regen-provider.ts; NO SPEND by default) ───
export type RegenField = { findingId: string; part: "title" | "whyItMatters" | "whatWedDo" | "textHook" } | { part: "openingHook" | "start.why" };

export interface RegenProposal { current: string; proposed: string; baseRevisionId: string; field: RegenField; }

function fieldLabelFor(field: RegenField): string {
  if ("findingId" in field) return field.part === "textHook" ? "finding hook" : field.part === "whyItMatters" ? "why-it-matters line" : field.part === "whatWedDo" ? "recommended action" : "finding title";
  return field.part === "openingHook" ? "opening hook" : "starting-point rationale";
}

export async function proposeRegeneration(leadId: string, field: RegenField, direction: string | undefined, opts: { actor?: string } = {}): Promise<{ ok: boolean; reason?: string; proposal?: RegenProposal }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "lead or review not found" };
  const baseRevisionId = revisionFingerprint(eff.review);
  const cur = currentSectionText(eff.review, field);
  if (cur == null) return { ok: false, reason: "section not found" };
  const evidenceContext = "findingId" in field
    ? (() => { const f = eff.review.findings.find((x) => x.id === field.findingId); return f ? `${f.observation} ${f.evidence.basis.join(" ")}` : ""; })()
    : eff.review.findings.map((f) => f.observation).join(" ");
  const { regenerateReviewCopy } = await import("./review-regen-provider");
  const result = await regenerateReviewCopy({ current: cur, evidenceContext, direction, fieldLabel: fieldLabelFor(field) });
  const actor = opts.actor ?? currentActor();
  if (result.status !== "succeeded" || !result.text) {
    await appendAudit({ action: A.regenFailed, actor, targetType: "lead", targetId: leadId, meta: { field, baseRevisionId, provider: result.provider, model: result.model, reason: result.reason ?? "failed" }, ip: null });
    return { ok: false, reason: result.reason ?? "regeneration failed — try again or edit directly" };
  }
  // Record the ACTUAL provider (mock vs live) and model — never present canned copy as live output.
  await appendAudit({ action: A.regenProposed, actor, targetType: "lead", targetId: leadId, meta: { field, baseRevisionId, provider: result.provider, model: result.model, promptVersion: result.promptVersion }, ip: null });
  return { ok: true, proposal: { current: cur, proposed: result.text, baseRevisionId, field } };
}

export async function acceptRegeneration(leadId: string, proposal: RegenProposal, opts: { actor?: string } = {}): Promise<{ ok: boolean; reason?: string; revisionId?: string }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "lead or review not found" };
  const currentId = revisionFingerprint(eff.review);
  if (proposal.baseRevisionId !== currentId) {
    await appendAudit({ action: A.regenRejected, actor: opts.actor ?? currentActor(), targetType: "lead", targetId: leadId, meta: { reason: "stale-base" }, ip: null });
    return { ok: false, reason: "this proposal was based on an older version — regenerate again" };
  }
  const overlay = overlayForField(proposal.field, proposal.proposed);
  const res = await saveDraft(leadId, overlay, { expectedBaseRevisionId: currentId, actor: opts.actor });
  if (res.ok) await appendAudit({ action: A.regenAccepted, actor: opts.actor ?? currentActor(), targetType: "lead", targetId: leadId, meta: { field: proposal.field, revisionId: res.revisionId }, ip: null });
  return res.ok ? { ok: true, revisionId: res.revisionId } : { ok: false, reason: res.reason };
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────
function nowIso(): string { return new Date().toISOString(); }
function mergeOverlay(a: ReviewOverlay, b: ReviewOverlay): ReviewOverlay {
  return {
    ...a, ...b,
    findings: { ...(a.findings ?? {}), ...(b.findings ?? {}) },
    start: { ...(a.start ?? {}), ...(b.start ?? {}) },
  };
}
function changedFields(o: ReviewOverlay): string[] {
  const out: string[] = [];
  if (o.openingHook !== undefined) out.push("openingHook");
  if (o.categoryLabel !== undefined) out.push("categoryLabel");
  if (o.start) out.push("start");
  if (o.closingLine !== undefined) out.push("closingLine");
  for (const id of Object.keys(o.findings ?? {})) for (const k of Object.keys(o.findings![id])) out.push(`finding:${id}:${k}`);
  return out;
}
function currentSectionText(review: QuickReview, field: RegenField): string | null {
  if ("findingId" in field) {
    const f = review.findings.find((x) => x.id === field.findingId);
    if (!f) return null;
    if (field.part === "textHook") return review.presentations.find((p) => p.findingId === f.id)?.textHook ?? null;
    return (f as any)[field.part] ?? null;
  }
  if (field.part === "openingHook") return review.openingHook;
  if (field.part === "start.why") return review.start?.why ?? null;
  return null;
}
function overlayForField(field: RegenField, text: string): ReviewOverlay {
  if ("findingId" in field) return { findings: { [field.findingId]: { [field.part]: text } } };
  if (field.part === "openingHook") return { openingHook: text };
  return { start: { why: text } };
}

// ── Artifact manifest: bind the ACTUAL PDF BYTES to the approved revision (M2 hardening, Gate 5) ──
export interface ArtifactManifest {
  leadId: string;
  revisionId: string;      // the approved content revision this PDF corresponds to
  evidenceDigest: string;  // hash of the evidence inputs (subset of the fingerprint)
  templateVersion: string;
  pdfSha256: string;       // hash of the exact bytes
  filename: string;
  renderedAt: string;
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Render the CURRENT effective review to PDF and produce a manifest binding those exact bytes to the
 *  current revision. The caller must have verified readiness (approval bound to this revision). */
async function renderArtifact(leadId: string, review: QuickReview, revisionId: string): Promise<{ pdf: Buffer; manifest: ArtifactManifest }> {
  const { renderQuickReviewPdf } = await import("../pdf/render");
  const { quickReviewFilename } = await import("./quick-review");
  const renderedAt = nowIso();
  const pdf = await renderQuickReviewPdf(review, renderedAt.slice(0, 10));
  const evidenceDigest = createHash("sha256").update(JSON.stringify(review.findings.map((f) => ({ id: f.id, basis: f.evidence.basis, src: f.evidence.sourceUrl, at: f.evidence.observedAt })))).digest("hex").slice(0, 20);
  const manifest: ArtifactManifest = { leadId, revisionId, evidenceDigest, templateVersion: TEMPLATE_VERSION, pdfSha256: sha256Hex(pdf), filename: quickReviewFilename(review.businessName), renderedAt };
  return { pdf, manifest };
}

/** Re-verify a manifest against its bytes and the CURRENT revision. Rejects mismatched/stale/corrupt. */
export function verifyArtifact(manifest: ArtifactManifest | null | undefined, pdf: Buffer | null | undefined, currentRevisionId: string): { ok: boolean; reason?: string } {
  if (!manifest || !pdf) return { ok: false, reason: "missing artifact or manifest" };
  if (manifest.templateVersion !== TEMPLATE_VERSION) return { ok: false, reason: "artifact was rendered on a different template version" };
  if (manifest.revisionId !== currentRevisionId) return { ok: false, reason: "artifact is stale — the review changed since it was rendered" };
  if (sha256Hex(pdf) !== manifest.pdfSha256) return { ok: false, reason: "artifact bytes do not match the manifest hash (corrupted or swapped)" };
  return { ok: true };
}

/**
 * The single safe gate every send path must pass. Backward compatible: when NO operator editing has
 * occurred (empty overlay, no approval, no history) it defers to the legacy review gate (returns
 * allowed with no artifact, so the existing path builds/attaches as before). When editing HAS
 * occurred, it REQUIRES a version-bound approval whose fingerprint matches the current content, then
 * renders + hashes the exact approved bytes and re-verifies them. Never returns allowed with a stale
 * or unapproved edited review; the caller must BLOCK the whole send (never send bare) when !allowed.
 */
export async function sendGate(leadId: string): Promise<{ allowed: boolean; edited: boolean; reason?: string; review?: QuickReview; pdf?: Buffer; manifest?: ArtifactManifest }> {
  const state = await getEditorialState(leadId);
  // "Skip / hold unsent" blocks delivery regardless of edit state — never interpreted as permission to send.
  if (state.held) return { allowed: false, edited: true, reason: `held: ${state.held.reason}` };
  const edited = Object.keys(state.draft ?? {}).length > 0 || state.approval != null || (state.history?.length ?? 0) > 0;
  if (!edited) return { allowed: true, edited: false }; // legacy gate applies downstream
  const readiness = await deliveryReadiness(leadId);
  if (!readiness) return { allowed: false, edited, reason: "no review" };
  if (!readiness.ready) return { allowed: false, edited, reason: readiness.reasons[0] };
  const eff = await effectiveReviewFor(leadId);
  const { pdf, manifest } = await renderArtifact(leadId, eff!.review, readiness.revisionId);
  const verify = verifyArtifact(manifest, pdf, readiness.revisionId);
  if (!verify.ok) return { allowed: false, edited, reason: verify.reason };
  return { allowed: true, edited, review: eff!.review, pdf, manifest };
}

// ── Skip / hold unsent (the 4th lightweight control) ─────────────────────────────────────────────
export async function skipReview(leadId: string, reason: string, opts: { actor?: string } = {}): Promise<{ ok: boolean; reason?: string }> {
  if (!reason || !reason.trim()) return { ok: false, reason: "a reason is required to hold a review" };
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "lead or review not found" };
  const actor = opts.actor ?? currentActor();
  const { rev: _r, ...prevNoRev } = eff.state;
  const c = await commitState(leadId, eff.state, { ...prevNoRev, held: { reason: reason.trim(), by: actor, at: nowIso() } }, { action: A.held, actor, targetType: "lead", targetId: leadId, meta: { reason: reason.trim() }, ip: null });
  if (!c.ok) return { ok: false, reason: c.conflict ? STALE_MSG : "lead or review not found" };
  return { ok: true };
}

export async function revisitReview(leadId: string, opts: { actor?: string } = {}): Promise<{ ok: boolean; reason?: string }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "lead or review not found" };
  const actor = opts.actor ?? currentActor();
  const { rev: _r, ...prevNoRev } = eff.state;
  const c = await commitState(leadId, eff.state, { ...prevNoRev, held: null }, { action: A.revisited, actor, targetType: "lead", targetId: leadId, meta: {}, ip: null });
  if (!c.ok) return { ok: false, reason: c.conflict ? STALE_MSG : "lead or review not found" };
  return { ok: true };
}

/** Render the CURRENT effective review to PDF + manifest for ANY lead (edited or unedited). Used by
 *  the automated send-authorization policy to bind an authorization to the exact bytes. */
export async function renderCurrentArtifact(leadId: string): Promise<{ review: QuickReview; pdf: Buffer; manifest: ArtifactManifest; revisionId: string } | null> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return null;
  const revisionId = revisionFingerprint(eff.review);
  const { pdf, manifest } = await renderArtifact(leadId, eff.review, revisionId);
  return { review: eff.review, pdf, manifest, revisionId };
}
