// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — quick-fix state lives in the Settings jsonb singleton (like
// sprintSessions): survives deploys, needs no migration, works in prod (Postgres)
// and in the in-memory store. Funnel events are appended to the canonical audit
// log. Offers are keyed by a deterministic offerId (`qfo_<offerVersion>`), so
// regenerating an unchanged offer reuses its record (idempotent by construction).
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getSettings, updateSettings, appendAudit } from "../repo";
import type { QuickFixOffer, JobState, AutomationLevel, OfferScope } from "./types";
import type { EvergreenAssetVersion } from "./evergreen-asset";
import { seedEvergreenExplainer } from "./evergreen-asset";
import type { CommerceRecord, CommerceStore } from "./stripe-commerce";
import type { WebhookDeps, WebhookOutcome } from "./webhook";
import type { TermsAcceptance } from "./terms";
import type { MaintenanceConsent } from "./maintenance";
import type { CustomerRecord } from "./lifecycle";
import type { CreditRecord } from "./fix-scan";
import { DEFAULT_AUTOMATION_LEVEL } from "./automation-policy";
import { computeDeliveryClock } from "./requirements";
import { canTransitionJob, initialJobStateAfterPayment, needsIntake } from "./fulfillment";
import { onVerifiedPurchase } from "./lifecycle";
import { FIX_SCAN_SKU } from "./fix-scan";
import { CANONICAL_EXPLAINER_SCRIPT } from "./evergreen-asset";
import { PERSUASION_POLICY_VERSION } from "./offer-readiness";
import type { PersonalizedDiagnosticVideoRecord } from "./personalized-video";

export type ApprovalStatus = "draft" | "approved" | "rejected";

/** Outreach-artifact lifecycle. Distinct from OfferState — it tracks the SEND
 *  workflow the operator drives (review → approve → schedule/send), never the
 *  offer's commercial state. Outbound is gated; SENT is set ONLY by an explicit,
 *  authorized send call — never as a side effect of approval. */
export type OutreachState =
  | "NEEDS_REVIEW"
  | "APPROVED_NOT_SENT"
  | "SCHEDULED"
  | "SENT"
  | "PURCHASED";

export interface StoredOffer extends QuickFixOffer {
  approvalStatus: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  recipientEmail: string | null;
  /** Unguessable capability token for the public offer link (revocable). */
  shareToken: string;
  /** True → the public link is revoked (404s) even if the token is known. */
  shareRevoked?: boolean;

  /** The persuasion-policy version this offer artifact was prepared under (Part U).
   *  Stamped at generation/preparation so downstream conversion + readiness attribute
   *  to the exact policy that produced it. Absent on legacy offers. */
  persuasionPolicyVersion?: string;
  /** Canonical evidence-version stamp for staleness (Part S). Records which snapshot of
   *  the offer's EvidencePackage the currently-bound dependent assets (PDF / personalized
   *  video / screenshot derivatives) were generated against. When the live evidence hash
   *  diverges from this, those assets are STALE and any approval taken against it is
   *  invalidated. Absent on legacy offers / offers with no bound derived assets. */
  evidenceVersion?: string;

  // ── Outreach-artifact subject + send lifecycle (all optional on legacy offers) ──
  /** The subject the operator has selected for first-touch (candidate or valid edit). */
  subjectSelected?: string | null;
  /** The mapped defect family of the selected subject (tracking + display). */
  subjectFamily?: string | null;
  /** The engine's alternate candidates offered for this subject. */
  subjectAlternatives?: string[];
  /** The subject-engine policy version that produced/validated the selection. */
  subjectPolicyVersion?: string;
  /** FROZEN at approval — the subject that was approved. Non-null ⇒ locked; changing
   *  the selected subject clears this and re-opens review. */
  approvedSubjectFrozen?: string | null;
  /** The send-workflow state. Absent ⇒ treat as NEEDS_REVIEW. */
  outreachState?: OutreachState;
  scheduledAt?: string | null;
  scheduledTz?: string | null;
  sentAt?: string | null;
  sentMailbox?: string | null;
  sentRecipient?: string | null;

  /** The per-offer personalized diagnostic video record (Part B). Absent ⇒ never
   *  generated. Its readiness is judged against the offer's CURRENT evidence +
   *  narration + render versions by personalizedVideoReadiness — a drifted/unplayable
   *  record is STALE, never silently READY. The evergreen video is separate + never
   *  substituted for this. */
  personalizedVideo?: PersonalizedDiagnosticVideoRecord;
}

// ── Persisted fulfillment sub-state (Part A) ─────────────────────────────────────
// These make the technician workspace DURABLE: a checked runbook step, a received
// access grant, a passed QA item, and an uploaded evidence artifact all survive a
// reload / a day later. Nothing here ever stores a password/credential/secret.
export type AccessItemStatus =
  | "NOT_REQUESTED" | "REQUESTED" | "RECEIVED" | "VERIFIED" | "BLOCKED" | "NOT_REQUIRED" | "REVOKED";

export interface RunbookStepState { done: boolean; completedBy?: string; completedAt?: string; notes?: string }
export interface RunbookState {
  /** Frozen when work starts — the historical playbook version of an in-progress job. */
  playbookId: string;
  frozenAt?: string;
  steps: Record<string, RunbookStepState>;
}
export interface AccessItemState {
  status: AccessItemStatus;
  method?: string;
  requestedAt?: string;
  receivedAt?: string;
  verifiedAt?: string;
  revokedAt?: string;
  notes?: string;
}
export interface QaItemState { done: boolean; at?: string }
export type EvidenceKind = "before" | "after" | "test" | "artifact" | "url";
export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  storageKey?: string | null;
  url?: string | null;
  label: string;
  /** What this artifact demonstrates — the operator MUST state it (no bare uploads). */
  demonstrates: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  at: string;
}

export interface JobRecord {
  offerId: string;
  leadId: string;
  state: JobState;
  purchasedAt: string | null;
  requirementsReceivedAt: string | null;
  fulfillmentClockStartedAt: string | null;
  targetDeliveryAt: string | null;
  subscriptionId: string | null;
  updatedAt: string;
  /** True → a demo/seed job. HARD-excluded from every real revenue/customer/sprint
   *  metric so a demonstration never inflates the money loop. Absent on real jobs. */
  isDemo?: boolean;
  // ── Persisted fulfillment sub-state (all optional; absent on legacy jobs) ──
  runbookState?: RunbookState;
  accessState?: Record<string, AccessItemState>;
  qaState?: Record<string, QaItemState>;
  evidence?: EvidenceItem[];
  /** Structured scope-complication decision (§22). When status==="open" the purchased scope stays FROZEN
   *  (offer.scope is never mutated) and the customer portal surfaces "Additional Decision Needed". Absent
   *  until a complication is raised. Reuses the ScopeGate concept but persists the decision→resolution arc. */
  scopeDecision?: PersistedScopeDecision;
}

/** Persisted, customer-safe scope-complication decision. offer.scope remains the frozen purchased promise. */
export interface PersistedScopeDecision {
  status: "open" | "resolved";
  /** Customer-safe description of what Artifex discovered. */
  discovered: string;
  /** What the original purchased scope still covers (frozen). */
  insideScope: string;
  /** What falls OUTSIDE the purchased scope (never silently absorbed). */
  outsideScope: string;
  /** Customer-safe options for the decision. */
  options: string[];
  recommendedRoute: "PROCEED" | "DIFFERENT_SKU" | "FIX_SCAN" | "CONVERSATION" | "REFUND_OR_CANCEL" | null;
  raisedAt: string;
  decision?: string | null;   // the chosen option (simulated in fixtures)
  decidedAt?: string | null;
}

export interface QuickFixState {
  automationLevel: AutomationLevel;
  offers: Record<string, StoredOffer>;
  evergreen: EvergreenAssetVersion[];
  jobs: Record<string, JobRecord>;
  customers: Record<string, CustomerRecord>;
  commerce: Record<string, CommerceRecord>;
  processedEvents: string[];
  terms: Record<string, TermsAcceptance>;
  /** Fix Scan repair credits, keyed by scanOfferId. */
  credits: Record<string, CreditRecord>;
  /** Separate recurring-maintenance consents, keyed by offerId. */
  maintenanceConsents: Record<string, MaintenanceConsent>;
}

const EMPTY: QuickFixState = {
  automationLevel: DEFAULT_AUTOMATION_LEVEL,
  offers: {},
  evergreen: [],
  jobs: {},
  customers: {},
  commerce: {},
  processedEvents: [],
  terms: {},
  credits: {},
  maintenanceConsents: {},
};

export function offerIdFor(offer: QuickFixOffer): string {
  return `qfo_${offer.offerVersion}`;
}

/** A fresh unguessable share token (256-bit, url-safe). */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function getState(): Promise<QuickFixState> {
  const s = (await getSettings()) as any;
  const qf = (s.quickFix ?? {}) as Partial<QuickFixState>;
  return { ...EMPTY, ...qf, evergreen: qf.evergreen ?? [] };
}

async function saveState(next: QuickFixState): Promise<void> {
  await updateSettings({ quickFix: next } as any);
}

async function mutate(fn: (s: QuickFixState) => void): Promise<QuickFixState> {
  const s = await getState();
  fn(s);
  await saveState(s);
  return s;
}

/** TEST ONLY: wipe the quick-fix substate via the store's OWN persistence path, so it reliably clears
 *  regardless of settings module-instance duplication (the general __resetStoreForTests does not reach
 *  the quickFix namespace). Fixtures call this in beforeEach for a genuinely empty fulfillment store. */
export async function __resetQuickFixForTests(): Promise<void> {
  await saveState({ ...EMPTY, offers: {}, jobs: {}, customers: {}, commerce: {}, processedEvents: [], terms: {}, credits: {}, maintenanceConsents: {}, evergreen: [] });
}

// ── Offers ─────────────────────────────────────────────────────────────────────
export async function upsertOffer(offer: QuickFixOffer, opts: { recipientEmail?: string | null; now: string } ): Promise<StoredOffer> {
  const id = offerIdFor(offer);
  let stored!: StoredOffer;
  await mutate((s) => {
    const prev = s.offers[id];
    stored = {
      ...offer,
      offerId: id,
      approvalStatus: prev?.approvalStatus ?? "draft",
      approvedBy: prev?.approvedBy ?? null,
      recipientEmail: opts.recipientEmail ?? prev?.recipientEmail ?? null,
      shareToken: prev?.shareToken ?? newShareToken(),
      shareRevoked: prev?.shareRevoked ?? false,
      // Stamp the persuasion-policy version at generation/preparation (Part U).
      persuasionPolicyVersion: PERSUASION_POLICY_VERSION,
      // Preserve any prior evidence-version stamp (bound assets keep their snapshot ref
      // until they are regenerated; the caller updates this when it re-binds derived assets).
      evidenceVersion: prev?.evidenceVersion,
      createdAt: prev?.createdAt ?? opts.now,
      updatedAt: opts.now,
    };
    s.offers[id] = stored;
  });
  await appendAudit({ action: "quickfix.offer_generated", actor: "engine", targetType: "quickfix_offer", targetId: id, meta: { band: offer.band, priceCents: offer.priceCents, eligible: offer.quickFixEligible, persuasionPolicyVersion: PERSUASION_POLICY_VERSION }, ip: null });
  return stored;
}

export async function getOffer(offerId: string): Promise<StoredOffer | null> {
  return (await getState()).offers[offerId] ?? null;
}

export async function listOffers(): Promise<StoredOffer[]> {
  return Object.values((await getState()).offers);
}

export async function setApproval(offerId: string, status: ApprovalStatus, actor: string, now: string): Promise<StoredOffer | null> {
  let out: StoredOffer | null = null;
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    o.approvalStatus = status;
    o.approvedBy = status === "approved" ? actor : o.approvedBy;
    o.state = status === "approved" ? "APPROVED" : status === "rejected" ? "DECLINED" : o.state;
    o.updatedAt = now;
    out = o;
  });
  if (out) await appendAudit({ action: `quickfix.offer_${status}`, actor, targetType: "quickfix_offer", targetId: offerId, meta: null, ip: null });
  return out;
}

// ── Personalized diagnostic video record (Part B/J) ─────────────────────────────
// The render worker persists a PersonalizedDiagnosticVideoRecord here as it moves
// through QUEUED → RENDERING → READY/FAILED. Idempotent by construction: the caller
// keys on the record's idempotencyKey, so re-running a render for identical inputs
// simply overwrites with the same asset. This never sends, charges, or mutates scope.
export async function setPersonalizedVideo(
  offerId: string,
  record: PersonalizedDiagnosticVideoRecord,
  opts: { actor: string; now: string },
): Promise<StoredOffer | null> {
  let out: StoredOffer | null = null;
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    o.personalizedVideo = record;
    o.updatedAt = opts.now;
    out = o;
  });
  if (out) {
    await appendAudit({
      action: "quickfix.personalized_video_set",
      actor: opts.actor,
      targetType: "quickfix_offer",
      targetId: offerId,
      meta: { status: record.status, evidenceVersion: record.evidenceVersion, renderVersion: record.renderVersion },
      ip: null,
    });
  }
  return out;
}

export async function getPersonalizedVideo(offerId: string): Promise<PersonalizedDiagnosticVideoRecord | null> {
  const o = (await getState()).offers[offerId];
  return o?.personalizedVideo ?? null;
}

/**
 * Regenerate an offer's customer-facing SCOPE COPY in place from freshly-derived
 * plain-language scope (rebuilt by the caller from the CURRENT capabilities), keeping
 * a HISTORY of the prior version. This is the mechanical fix for offers whose stored
 * scope text was frozen before the plain-language policy shipped. It:
 *   • replaces offer.scope with the new plain-language scope,
 *   • re-stamps persuasionPolicyVersion (forces a Breakbot re-validation),
 *   • clears the frozen subject + re-opens review (a changed message can't inherit a
 *     prior sign-off),
 *   • preserves the prior scope + policy version in scopeHistory for audit/rollback.
 * It NEVER changes price, SKU, capabilityKeys, findings, evidence, or share token, and
 * NEVER sends. Returns the updated offer (or null if not found / scope unchanged).
 */
export async function replaceOfferScope(
  offerId: string,
  nextScope: OfferScope,
  opts: { actor: string; now: string; reason?: string },
): Promise<StoredOffer | null> {
  let out: StoredOffer | null = null;
  let changed = false;
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    const prevScopeJson = JSON.stringify(o.scope);
    if (prevScopeJson === JSON.stringify(nextScope)) {
      // No copy change — restamp policy only so currency is provable, but don't churn history.
      o.persuasionPolicyVersion = PERSUASION_POLICY_VERSION;
      o.updatedAt = opts.now;
      out = o;
      return;
    }
    const history = ((o as any).scopeHistory ?? []) as Array<Record<string, unknown>>;
    history.push({
      at: opts.now,
      persuasionPolicyVersion: o.persuasionPolicyVersion ?? null,
      scope: o.scope,
      reason: opts.reason ?? "customer-language regeneration",
    });
    (o as any).scopeHistory = history;
    o.scope = nextScope;
    o.persuasionPolicyVersion = PERSUASION_POLICY_VERSION;
    // A changed customer message must be re-reviewed: clear the freeze + re-open review.
    o.approvedSubjectFrozen = null;
    o.approvalStatus = "draft";
    o.approvedBy = null;
    o.outreachState = "NEEDS_REVIEW";
    if (o.state === "APPROVED") o.state = "DRAFT";
    o.updatedAt = opts.now;
    out = o;
    changed = true;
  });
  if (out && changed) {
    await appendAudit({
      action: "quickfix.offer_scope_regenerated",
      actor: opts.actor,
      targetType: "quickfix_offer",
      targetId: offerId,
      meta: { persuasionPolicyVersion: PERSUASION_POLICY_VERSION, reason: opts.reason ?? "customer-language regeneration" },
      ip: null,
    });
  }
  return out;
}

// ── Outreach-artifact subject + send lifecycle ───────────────────────────────────
// A tiny, auditable state machine layered onto the offer record. The design rule is
// SAFETY-FIRST: approval only FREEZES a subject (it never sends); sending is a
// separate explicit call that is additionally gated by the legacy-freeze / pause
// guards at the ROUTE boundary; and any subject edit after approval INVALIDATES the
// approval so a changed message can never inherit a prior sign-off. None of these
// helpers touch evidence / scope / price / SKU / share token — only the fields above.

export function effectiveOutreachState(o: StoredOffer): OutreachState {
  return o.outreachState ?? "NEEDS_REVIEW";
}

export interface SubjectLifecycleResult {
  ok: boolean;
  /** Set when ok=false — a stable machine reason. */
  reason?: "not_found" | "frozen" | "invalid_subject" | "not_approved" | "no_subject" | "not_sendable" | "bad_state";
  offer: StoredOffer | null;
}

/**
 * Select the first-touch subject. Allowed ONLY while the subject is NOT frozen
 * (i.e. not currently approved) — a frozen subject returns {ok:false,reason:"frozen"}
 * so the caller can 409. Setting a subject NEVER approves and NEVER sends. If an
 * approval was in place (shouldn't be, given the freeze), changing the subject
 * invalidates it and re-opens review.
 */
export async function selectOutreachSubject(
  offerId: string,
  subject: string,
  opts: { family?: string | null; alternatives?: string[]; policyVersion?: string; actor: string; now: string },
): Promise<SubjectLifecycleResult> {
  let result: SubjectLifecycleResult = { ok: false, reason: "not_found", offer: null };
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    if (o.approvedSubjectFrozen) { result = { ok: false, reason: "frozen", offer: o }; return; }
    o.subjectSelected = subject;
    if (opts.family !== undefined) o.subjectFamily = opts.family;
    if (opts.alternatives !== undefined) o.subjectAlternatives = opts.alternatives;
    if (opts.policyVersion !== undefined) o.subjectPolicyVersion = opts.policyVersion;
    // Selecting a subject re-opens review; approval (if any) is invalidated.
    o.approvedSubjectFrozen = null;
    o.approvalStatus = o.approvalStatus === "approved" ? "draft" : o.approvalStatus;
    o.outreachState = "NEEDS_REVIEW";
    o.updatedAt = opts.now;
    result = { ok: true, offer: o };
  });
  if (result.ok) await appendAudit({ action: "quickfix.subject_selected", actor: opts.actor, targetType: "quickfix_offer", targetId: offerId, meta: { subject, family: opts.family ?? null, policyVersion: opts.policyVersion ?? null }, ip: null });
  return result;
}

/**
 * Approve the outreach artifact: requires a selected subject, FREEZES it, and moves
 * to APPROVED_NOT_SENT. This NEVER sends and NEVER schedules — it is purely a sign-off.
 */
export async function approveOutreach(offerId: string, opts: { actor: string; now: string }): Promise<SubjectLifecycleResult> {
  let result: SubjectLifecycleResult = { ok: false, reason: "not_found", offer: null };
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    if (!o.subjectSelected) { result = { ok: false, reason: "no_subject", offer: o }; return; }
    o.approvedSubjectFrozen = o.subjectSelected;
    o.approvalStatus = "approved";
    o.approvedBy = opts.actor;
    o.state = "APPROVED";
    o.outreachState = "APPROVED_NOT_SENT";
    o.updatedAt = opts.now;
    result = { ok: true, offer: o };
  });
  if (result.ok) await appendAudit({ action: "quickfix.outreach_approved", actor: opts.actor, targetType: "quickfix_offer", targetId: offerId, meta: { subject: result.offer?.approvedSubjectFrozen ?? null }, ip: null });
  return result;
}

/**
 * Mark the artifact SENT. This is called ONLY by the send route AFTER the outbound
 * gates have cleared — this helper does not itself dispatch email. It transitions
 * APPROVED_NOT_SENT → SENT and records the dispatch facts. Any other source state
 * is a bad_state (never re-send).
 */
export async function markOutreachSent(
  offerId: string,
  opts: { actor: string; now: string; mailbox: string | null; recipient: string | null },
): Promise<SubjectLifecycleResult> {
  let result: SubjectLifecycleResult = { ok: false, reason: "not_found", offer: null };
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    const st = o.outreachState ?? "NEEDS_REVIEW";
    if (st !== "APPROVED_NOT_SENT" && st !== "SCHEDULED") { result = { ok: false, reason: "not_sendable", offer: o }; return; }
    o.outreachState = "SENT";
    o.sentAt = opts.now;
    o.sentMailbox = opts.mailbox;
    o.sentRecipient = opts.recipient;
    o.state = "SENT";
    o.updatedAt = opts.now;
    result = { ok: true, offer: o };
  });
  if (result.ok) await appendAudit({ action: "quickfix.outreach_sent", actor: opts.actor, targetType: "quickfix_offer", targetId: offerId, meta: { mailbox: opts.mailbox, recipient: opts.recipient }, ip: null });
  return result;
}

/**
 * Schedule (or reschedule) a send for an explicit date/time+tz. Requires the artifact
 * to be approved (APPROVED_NOT_SENT or already SCHEDULED). Passing scheduledAt=null
 * CANCELS the schedule and returns to APPROVED_NOT_SENT. Scheduling never dispatches.
 */
export async function scheduleOutreach(
  offerId: string,
  opts: { scheduledAt: string | null; tz: string | null; actor: string; now: string },
): Promise<SubjectLifecycleResult> {
  let result: SubjectLifecycleResult = { ok: false, reason: "not_found", offer: null };
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    const st = o.outreachState ?? "NEEDS_REVIEW";
    if (st !== "APPROVED_NOT_SENT" && st !== "SCHEDULED") { result = { ok: false, reason: "not_approved", offer: o }; return; }
    if (opts.scheduledAt === null) {
      // Cancel → back to approved-not-sent.
      o.scheduledAt = null;
      o.scheduledTz = null;
      o.outreachState = "APPROVED_NOT_SENT";
    } else {
      o.scheduledAt = opts.scheduledAt;
      o.scheduledTz = opts.tz;
      o.outreachState = "SCHEDULED";
    }
    o.updatedAt = opts.now;
    result = { ok: true, offer: o };
  });
  if (result.ok) await appendAudit({ action: opts.scheduledAt === null ? "quickfix.outreach_schedule_canceled" : "quickfix.outreach_scheduled", actor: opts.actor, targetType: "quickfix_offer", targetId: offerId, meta: { scheduledAt: opts.scheduledAt, tz: opts.tz }, ip: null });
  return result;
}

// ── Evergreen ────────────────────────────────────────────────────────────────
export async function ensureEvergreenSeed(now: string): Promise<EvergreenAssetVersion[]> {
  const s = await getState();
  if (s.evergreen.length) return s.evergreen;
  const seeded = await mutate((st) => { st.evergreen = [seedEvergreenExplainer(now)]; });
  return seeded.evergreen;
}

export async function getEvergreen(): Promise<EvergreenAssetVersion[]> {
  return (await getState()).evergreen;
}

export async function saveEvergreen(versions: EvergreenAssetVersion[]): Promise<void> {
  await mutate((s) => { s.evergreen = versions; });
}

// ── Terms ──────────────────────────────────────────────────────────────────────
export async function saveTermsAcceptance(acc: TermsAcceptance): Promise<void> {
  await mutate((s) => { s.terms[acc.offerId] = acc; });
  await appendAudit({ action: "quickfix.terms_accepted", actor: acc.customerEmail, targetType: "quickfix_offer", targetId: acc.offerId, meta: { termsVersion: acc.termsVersion, digest: acc.digest, termsDocumentSha: acc.termsDocumentSha, service: acc.service }, ip: null });
}
export async function getTermsAcceptance(offerId: string): Promise<TermsAcceptance | null> {
  return (await getState()).terms[offerId] ?? null;
}

// ── Recurring-maintenance consent (separate affirmative opt-in) ─────────────────
export async function saveMaintenanceConsent(consent: MaintenanceConsent): Promise<void> {
  await mutate((s) => { s.maintenanceConsents[consent.offerId] = consent; });
  await appendAudit({ action: "quickfix.maintenance_consent", actor: consent.customerEmail, targetType: "quickfix_offer", targetId: consent.offerId, meta: { planKey: consent.planKey, monthlyCents: consent.monthlyCents, consentVersion: consent.consentVersion, digest: consent.digest }, ip: null });
}
export async function getMaintenanceConsent(offerId: string): Promise<MaintenanceConsent | null> {
  return (await getState()).maintenanceConsents[offerId] ?? null;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
export async function upsertJob(job: JobRecord): Promise<void> {
  await mutate((s) => { s.jobs[job.offerId] = job; });
}
export async function getJob(offerId: string): Promise<JobRecord | null> {
  return (await getState()).jobs[offerId] ?? null;
}
export async function listJobs(): Promise<JobRecord[]> {
  return Object.values((await getState()).jobs);
}

// ── Persisted fulfillment sub-state mutations (Part A) ──────────────────────────
// Every mutation is idempotent and appends an audit event. Marking the SAME terminal
// transition twice does not append a duplicate audit (we compare against the prior
// persisted value and no-op when nothing changed). A password/credential is NEVER
// accepted anywhere in this surface — the access model has no secret field at all.

/** Freeze the playbook version onto the job when work starts. Idempotent: a second
 *  call NEVER overwrites the already-frozen playbookId (the historical version of an
 *  in-progress job is immutable). Refreshing the runbook must NOT reset step state. */
export async function startRunbook(offerId: string, playbookId: string, now = new Date().toISOString()): Promise<JobRecord | null> {
  let out: JobRecord | null = null;
  let froze = false;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    if (!job.runbookState) {
      job.runbookState = { playbookId, frozenAt: now, steps: {} };
      froze = true;
    }
    // If already frozen, keep the ORIGINAL playbookId + steps untouched.
    job.updatedAt = now;
    out = job;
  });
  if (froze) await appendAudit({ action: "quickfix.runbook_started", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { playbookId }, ip: null });
  return out;
}

/** Mark/unmark a runbook step. Idempotent: setting the same done value twice does not
 *  append a duplicate audit. Freezes the playbook on first write if not yet frozen. */
export async function setRunbookStep(
  offerId: string,
  stepId: string,
  patch: { done: boolean; by?: string; notes?: string; playbookId?: string },
  now = new Date().toISOString(),
): Promise<JobRecord | null> {
  let out: JobRecord | null = null;
  let changed = false;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    if (!job.runbookState) job.runbookState = { playbookId: patch.playbookId ?? "unknown", frozenAt: now, steps: {} };
    const prev = job.runbookState.steps[stepId];
    if (prev && prev.done === patch.done && (patch.notes ?? prev.notes) === prev.notes) { out = job; return; }
    changed = true;
    job.runbookState.steps[stepId] = {
      done: patch.done,
      completedBy: patch.done ? (patch.by ?? "operator") : undefined,
      completedAt: patch.done ? now : undefined,
      notes: patch.notes ?? prev?.notes,
    };
    job.updatedAt = now;
    out = job;
  });
  if (changed) await appendAudit({ action: "quickfix.runbook_step", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { stepId, done: patch.done }, ip: null });
  return out;
}

const ACCESS_STATUSES: AccessItemState["status"][] = ["NOT_REQUESTED", "REQUESTED", "RECEIVED", "VERIFIED", "BLOCKED", "NOT_REQUIRED", "REVOKED"];

/** Patch one access requirement's lifecycle. Fail-closed: a scoped-token/secret method
 *  with no secure vault is forced to BLOCKED (never RECEIVED/VERIFIED), and no secret is
 *  ever stored. Idempotent: a no-op patch appends no audit. */
export async function setAccessItem(
  offerId: string,
  key: string,
  patch: Partial<AccessItemState>,
  now = new Date().toISOString(),
): Promise<JobRecord | null> {
  let out: JobRecord | null = null;
  let changed = false;
  let nextStatus: AccessItemState["status"] | null = null;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    if (!job.accessState) job.accessState = {};
    const prev = job.accessState[key] ?? { status: "NOT_REQUESTED" as const };
    let next: AccessItemState = { ...prev, ...patch };
    if (patch.status && !ACCESS_STATUSES.includes(patch.status)) next.status = prev.status;
    // FAIL CLOSED: a method that needs a plaintext secret has no secure vault → BLOCKED.
    const needsSecret = (next.method ?? "").toLowerCase() === "scoped-token" || (next.method ?? "").toLowerCase() === "blocked-no-vault";
    if (needsSecret && (next.status === "RECEIVED" || next.status === "VERIFIED")) {
      next.status = "BLOCKED";
      next.notes = "No secure credential vault — scoped-secret path is blocked; use native invite or Access Assist.";
    }
    // stamp lifecycle timestamps
    if (next.status === "REQUESTED" && !next.requestedAt) next.requestedAt = now;
    if (next.status === "RECEIVED" && !next.receivedAt) next.receivedAt = now;
    if (next.status === "VERIFIED" && !next.verifiedAt) next.verifiedAt = now;
    if (next.status === "REVOKED" && !next.revokedAt) next.revokedAt = now;
    if (JSON.stringify(prev) === JSON.stringify(next)) { out = job; return; }
    changed = true;
    job.accessState[key] = next;
    nextStatus = next.status;
    job.updatedAt = now;
    out = job;
  });
  if (changed) await appendAudit({ action: "quickfix.access_item", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { key, status: nextStatus }, ip: null });
  return out;
}

/** Mark/unmark a QA checklist item. Idempotent. */
export async function setQaItem(offerId: string, itemId: string, done: boolean, now = new Date().toISOString()): Promise<JobRecord | null> {
  let out: JobRecord | null = null;
  let changed = false;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    if (!job.qaState) job.qaState = {};
    const prev = job.qaState[itemId];
    if (prev && prev.done === done) { out = job; return; }
    changed = true;
    job.qaState[itemId] = { done, at: done ? now : undefined };
    job.updatedAt = now;
    out = job;
  });
  if (changed) await appendAudit({ action: "quickfix.qa_item", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { itemId, done }, ip: null });
  return out;
}

/**
 * Raise a scope complication (§22). Records a customer-safe decision on the job WITHOUT mutating the
 * frozen purchased scope (offer.scope is never touched). Audited — the first half of the decision arc.
 */
export async function raiseScopeException(
  offerId: string,
  input: Omit<PersistedScopeDecision, "status" | "raisedAt" | "decision" | "decidedAt">,
  opts: { now?: string; actor?: string } = {},
): Promise<JobRecord | null> {
  const now = opts.now ?? new Date().toISOString();
  let out: JobRecord | null = null;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    job.scopeDecision = { ...input, status: "open", raisedAt: now, decision: null, decidedAt: null };
    job.updatedAt = now;
    out = job;
  });
  if (out) await appendAudit({ action: "quickfix.scope_exception_raised", actor: opts.actor ?? "operator", targetType: "quickfix_job", targetId: offerId, meta: { outsideScope: input.outsideScope, recommendedRoute: input.recommendedRoute }, ip: null });
  return out;
}

/** Resolve an open scope complication with the (simulated) customer decision. Audited — the second half. */
export async function resolveScopeException(
  offerId: string,
  decision: string,
  opts: { now?: string; actor?: string } = {},
): Promise<JobRecord | null> {
  const now = opts.now ?? new Date().toISOString();
  let out: JobRecord | null = null;
  let changed = false;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job || !job.scopeDecision || job.scopeDecision.status === "resolved") { out = job ?? null; return; }
    job.scopeDecision = { ...job.scopeDecision, status: "resolved", decision, decidedAt: now };
    job.updatedAt = now;
    changed = true;
    out = job;
  });
  if (changed) await appendAudit({ action: "quickfix.scope_exception_resolved", actor: opts.actor ?? "customer", targetType: "quickfix_job", targetId: offerId, meta: { decision }, ip: null });
  return out;
}

/** Associate an evidence artifact with the job (immutable/audited). De-dupes by
 *  (kind + storageKey|url) so a double-submit does not create unbounded duplicates.
 *  NEVER stores a secret — the caller validates filename/type/size before upload. */
export async function addEvidence(offerId: string, item: Omit<EvidenceItem, "id" | "at"> & { id?: string; at?: string }, now = new Date().toISOString()): Promise<{ job: JobRecord | null; item: EvidenceItem | null; deduped: boolean }> {
  let out: JobRecord | null = null;
  let stored: EvidenceItem | null = null;
  let deduped = false;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    if (!job.evidence) job.evidence = [];
    const dupeKeyOf = (e: { kind: string; storageKey?: string | null; url?: string | null }) => `${e.kind}|${e.storageKey ?? ""}|${e.url ?? ""}`;
    const wantKey = dupeKeyOf(item);
    const existing = job.evidence.find((e) => dupeKeyOf(e) === wantKey && (item.storageKey || item.url));
    if (existing) { deduped = true; stored = existing; out = job; return; }
    stored = {
      id: item.id ?? `ev_${randomBytes(8).toString("hex")}`,
      kind: item.kind,
      storageKey: item.storageKey ?? null,
      url: item.url ?? null,
      label: item.label,
      demonstrates: item.demonstrates,
      filename: item.filename,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      at: item.at ?? now,
    };
    job.evidence.push(stored);
    job.updatedAt = now;
    out = job;
  });
  const storedItem = stored as EvidenceItem | null;
  if (storedItem && !deduped) await appendAudit({ action: "quickfix.evidence_added", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { id: storedItem.id, kind: storedItem.kind, demonstrates: storedItem.demonstrates, storageKey: storedItem.storageKey ?? null }, ip: null });
  return { job: out, item: stored, deduped };
}

// ── Customers ──────────────────────────────────────────────────────────────────
export async function getCustomer(leadId: string): Promise<CustomerRecord | null> {
  return (await getState()).customers[leadId] ?? null;
}
export async function upsertCustomer(rec: CustomerRecord): Promise<void> {
  await mutate((s) => { s.customers[rec.leadId] = rec; });
}

// ── Automation level ────────────────────────────────────────────────────────────
export async function getAutomationLevel(): Promise<AutomationLevel> {
  return (await getState()).automationLevel;
}

// ── Commerce idempotency store (CommerceStore impl) ─────────────────────────────
export const commerceStore: CommerceStore = {
  async get(key) { return (await getState()).commerce[key] ?? null; },
  async listForOffer(offerId) { return Object.values((await getState()).commerce).filter((r) => r.offerId === offerId); },
  async put(rec) { await mutate((s) => { s.commerce[rec.key] = rec; }); },
};

/** Resolve an offer by its public share token (constant-time). Null if revoked/absent. */
export async function getOfferByShareToken(token: string): Promise<StoredOffer | null> {
  if (!token) return null;
  const state = await getState();
  const want = Buffer.from(token);
  for (const o of Object.values(state.offers)) {
    if (!o.shareToken || o.shareRevoked) continue;
    const have = Buffer.from(o.shareToken);
    if (have.length === want.length && timingSafeEqual(have, want)) return o;
  }
  return null;
}

/** Accept either a raw offerId (unguessable qfo_<hash>) or a share token. */
export async function resolveOffer(seg: string): Promise<StoredOffer | null> {
  const byToken = await getOfferByShareToken(seg);
  if (byToken) return byToken;
  // The offerId is itself an unguessable hash (qfo_<sha256>), so it is a valid
  // accessor for the success/cancel round-trip Stripe builds from offerId.
  return await getOffer(seg);
}

/** Rotate/revoke the public link. `revoke` → link 404s; otherwise a fresh token is issued. */
export async function rotateShareToken(offerId: string, opts: { revoke: boolean; now: string }): Promise<StoredOffer | null> {
  let out: StoredOffer | null = null;
  await mutate((s) => {
    const o = s.offers[offerId];
    if (!o) return;
    o.shareRevoked = opts.revoke;
    if (!opts.revoke) o.shareToken = newShareToken();
    o.updatedAt = opts.now;
    out = o;
  });
  if (out) await appendAudit({ action: opts.revoke ? "quickfix.share_revoked" : "quickfix.share_rotated", actor: "operator", targetType: "quickfix_offer", targetId: offerId, meta: null, ip: null });
  return out;
}

// ── Intake completion → READY_FOR_FULFILLMENT (delivery clock starts here) ───────
export async function completeIntake(offerId: string, now: string): Promise<JobRecord | null> {
  const offer = await getOffer(offerId);
  if (!offer) return null;
  let out: JobRecord | null = null;
  await mutate((s) => {
    const job = s.jobs[offerId];
    if (!job) return;
    // Only advance from the waiting state; never from a terminal/later state.
    if (job.state !== "WAITING_FOR_CUSTOMER_INPUT" && job.state !== "READY_FOR_FULFILLMENT") { out = job; return; }
    const clock = computeDeliveryClock({ offer, purchasedAt: job.purchasedAt, requirementsReceivedAt: job.requirementsReceivedAt ?? now });
    const nextState = job.state === "WAITING_FOR_CUSTOMER_INPUT" && canTransitionJob(job.state, "READY_FOR_FULFILLMENT") ? "READY_FOR_FULFILLMENT" : job.state;
    out = {
      ...job,
      state: nextState,
      requirementsReceivedAt: job.requirementsReceivedAt ?? now,
      fulfillmentClockStartedAt: clock.fulfillmentClockStartedAt,
      targetDeliveryAt: clock.targetDeliveryAt,
      updatedAt: now,
    };
    s.jobs[offerId] = out;
  });
  const done = out as JobRecord | null;
  if (done) await appendAudit({ action: "quickfix.intake_completed", actor: "customer", targetType: "quickfix_job", targetId: offerId, meta: { state: done.state, targetDeliveryAt: done.targetDeliveryAt }, ip: null });
  return done;
}

// ── Fix Scan credits ─────────────────────────────────────────────────────────
export async function putCredit(rec: CreditRecord): Promise<void> {
  await mutate((s) => { s.credits[rec.scanOfferId] = rec; });
}
export async function getCredit(scanOfferId: string): Promise<CreditRecord | null> {
  return (await getState()).credits[scanOfferId] ?? null;
}
export async function listCredits(): Promise<CreditRecord[]> {
  return Object.values((await getState()).credits);
}
/** Mark a credit consumed (single-use). Returns false if already used/absent. */
export async function consumeCredit(scanOfferId: string, usedOnOfferId: string): Promise<boolean> {
  let ok = false;
  await mutate((s) => {
    const c = s.credits[scanOfferId];
    if (!c || c.used) return;
    c.used = true;
    c.usedOnOfferId = usedOnOfferId;
    ok = true;
  });
  if (ok) await appendAudit({ action: "quickfix.credit_used", actor: "customer", targetType: "quickfix_credit", targetId: scanOfferId, meta: { usedOnOfferId }, ip: null });
  return ok;
}

// ── Evergreen trust-asset version operations ─────────────────────────────────
async function ensureEvergreen(now: string): Promise<EvergreenAssetVersion[]> {
  return ensureEvergreenSeed(now);
}
/** Add a new draft version (max version + 1) carrying the canonical script. */
export async function addEvergreenDraft(now: string): Promise<EvergreenAssetVersion> {
  await ensureEvergreen(now);
  let created!: EvergreenAssetVersion;
  await mutate((s) => {
    const nextV = (s.evergreen.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
    created = { role: "ARTIFEX_QUICK_FIX_EXPLAINER", variant: "GENERAL_QUICK_FIX", version: nextV, assetUrl: null, durationSeconds: null, script: CANONICAL_EXPLAINER_SCRIPT, status: "draft", createdAt: now, updatedAt: now };
    s.evergreen.push(created);
  });
  await appendAudit({ action: "quickfix.evergreen_draft_added", actor: "operator", targetType: "quickfix_evergreen", targetId: String(created.version), meta: null, ip: null });
  return created;
}
/** Attach a rendered/uploaded asset URL + duration to a version (does not activate). */
export async function attachEvergreenAsset(version: number, assetUrl: string, durationSeconds: number | null, now: string): Promise<EvergreenAssetVersion | null> {
  let out: EvergreenAssetVersion | null = null;
  await mutate((s) => {
    const v = s.evergreen.find((e) => e.version === version);
    if (!v) return;
    v.assetUrl = assetUrl; v.durationSeconds = durationSeconds; v.updatedAt = now; out = v;
  });
  if (out) await appendAudit({ action: "quickfix.evergreen_asset_attached", actor: "operator", targetType: "quickfix_evergreen", targetId: String(version), meta: { assetUrl, durationSeconds }, ip: null });
  return out;
}
/** Activate a version (retiring other active versions of the same variant). */
export async function activateEvergreen(version: number, now: string): Promise<EvergreenAssetVersion | null> {
  let out: EvergreenAssetVersion | null = null;
  await mutate((s) => {
    const v = s.evergreen.find((e) => e.version === version);
    if (!v) return;
    for (const e of s.evergreen) if (e.variant === v.variant && e.status === "active" && e.version !== version) { e.status = "retired"; e.updatedAt = now; }
    v.status = "active"; v.updatedAt = now; out = v;
  });
  if (out) await appendAudit({ action: "quickfix.evergreen_activated", actor: "operator", targetType: "quickfix_evergreen", targetId: String(version), meta: null, ip: null });
  return out;
}
/** Retire a version (never regenerates offers — offer pages just select the next active). */
export async function retireEvergreen(version: number, now: string): Promise<EvergreenAssetVersion | null> {
  let out: EvergreenAssetVersion | null = null;
  await mutate((s) => {
    const v = s.evergreen.find((e) => e.version === version);
    if (!v) return;
    v.status = "retired"; v.updatedAt = now; out = v;
  });
  if (out) await appendAudit({ action: "quickfix.evergreen_retired", actor: "operator", targetType: "quickfix_evergreen", targetId: String(version), meta: null, ip: null });
  return out;
}

// ── Funnel event recording (measurable events only) ──────────────────────────
export async function recordFunnelEvent(event: string, args: { offerId: string; actor?: string; meta?: Record<string, unknown> | null; ip?: string | null }): Promise<void> {
  await appendAudit({ action: event, actor: args.actor ?? "customer", targetType: "quickfix_offer", targetId: args.offerId, meta: (args.meta ?? null) as any, ip: args.ip ?? null });
}

// ── Canonical fulfillment handlers — the SINGLE source of "paid → fulfil". ──────
// Used by the webhook route AND the test-mode rehearsal so both exercise the exact
// same path. Handles repairs and Fix Scan purchases; consumes a Fix Scan credit
// only on a verified repair payment (single-use, fail-closed).
export function fulfillmentHandlers(nowIso: string): Pick<WebhookDeps, "applyPaid" | "applySubscription"> {
  return {
    async applyPaid(o: Extract<WebhookOutcome, { kind: "payment_succeeded" }>) {
      if (o.purchaseType === "FIX_SCAN") {
        await upsertJob({ offerId: o.offerId, leadId: o.leadId, state: "WAITING_FOR_CUSTOMER_INPUT", purchasedAt: nowIso, requirementsReceivedAt: null, fulfillmentClockStartedAt: null, targetDeliveryAt: null, subscriptionId: null, updatedAt: nowIso });
        const existing = await getCustomer(o.leadId);
        const { record } = onVerifiedPurchase(existing, { leadId: o.leadId, email: "", offerId: o.offerId, amountCents: o.amountTotalCents ?? FIX_SCAN_SKU.priceCents, at: nowIso, maintenancePlanKey: null, purchaseType: "FIX_SCAN" });
        await upsertCustomer(record);
        await recordFunnelEvent("quickfix.fix_scan_purchased", { offerId: o.offerId, actor: "stripe", meta: { leadId: o.leadId } });
        return;
      }
      const offer = await getOffer(o.offerId);
      if (!offer) return;
      const intake = needsIntake(offer);
      await upsertJob({ offerId: o.offerId, leadId: o.leadId || offer.leadId, state: initialJobStateAfterPayment(intake), purchasedAt: nowIso, requirementsReceivedAt: null, fulfillmentClockStartedAt: null, targetDeliveryAt: null, subscriptionId: o.subscriptionId, updatedAt: nowIso });
      const existing = await getCustomer(offer.leadId);
      const { record } = onVerifiedPurchase(existing, { leadId: offer.leadId, email: offer.recipientEmail ?? "", offerId: o.offerId, amountCents: o.amountTotalCents ?? offer.priceCents, at: nowIso, maintenancePlanKey: offer.maintenance?.planKey ?? null });
      await upsertCustomer(record);
      await recordFunnelEvent("quickfix.purchase_completed", { offerId: o.offerId, actor: "stripe", meta: { leadId: offer.leadId, creditAppliedCents: o.creditAppliedCents } });
      if (o.creditScanOfferId && o.creditAppliedCents > 0) await consumeCredit(o.creditScanOfferId, o.offerId);
    },
    async applySubscription(o: Extract<WebhookOutcome, { kind: "subscription_changed" }>) {
      const job = await getJob(o.offerId);
      if (job) await upsertJob({ ...job, subscriptionId: o.subscriptionId });
    },
  };
}

// ── Webhook idempotency (processed events) ──────────────────────────────────────
export async function webhookDeps(handlers: Pick<WebhookDeps, "applyPaid" | "applySubscription">): Promise<WebhookDeps> {
  return {
    async alreadyProcessed(id) { return (await getState()).processedEvents.includes(id); },
    async markProcessed(id, outcome: WebhookOutcome) {
      await mutate((s) => { if (!s.processedEvents.includes(id)) s.processedEvents.push(id); });
      await appendAudit({ action: "quickfix.webhook_processed", actor: "stripe", targetType: "quickfix_event", targetId: id, meta: { kind: outcome.kind }, ip: null });
    },
    applyPaid: handlers.applyPaid,
    applySubscription: handlers.applySubscription,
  };
}
