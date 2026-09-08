// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — quick-fix state lives in the Settings jsonb singleton (like
// sprintSessions): survives deploys, needs no migration, works in prod (Postgres)
// and in the in-memory store. Funnel events are appended to the canonical audit
// log. Offers are keyed by a deterministic offerId (`qfo_<offerVersion>`), so
// regenerating an unchanged offer reuses its record (idempotent by construction).
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getSettings, updateSettings, appendAudit } from "../repo";
import type { QuickFixOffer, JobState, AutomationLevel } from "./types";
import type { EvergreenAssetVersion } from "./evergreen-asset";
import { seedEvergreenExplainer } from "./evergreen-asset";
import type { CommerceRecord, CommerceStore } from "./stripe-commerce";
import type { WebhookDeps, WebhookOutcome } from "./webhook";
import type { TermsAcceptance } from "./terms";
import type { CustomerRecord } from "./lifecycle";
import type { CreditRecord } from "./fix-scan";
import { DEFAULT_AUTOMATION_LEVEL } from "./automation-policy";
import { computeDeliveryClock } from "./requirements";
import { canTransitionJob, initialJobStateAfterPayment, needsIntake } from "./fulfillment";
import { onVerifiedPurchase } from "./lifecycle";
import { FIX_SCAN_SKU } from "./fix-scan";
import { CANONICAL_EXPLAINER_SCRIPT } from "./evergreen-asset";

export type ApprovalStatus = "draft" | "approved" | "rejected";

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
      createdAt: prev?.createdAt ?? opts.now,
      updatedAt: opts.now,
    };
    s.offers[id] = stored;
  });
  await appendAudit({ action: "quickfix.offer_generated", actor: "engine", targetType: "quickfix_offer", targetId: id, meta: { band: offer.band, priceCents: offer.priceCents, eligible: offer.quickFixEligible }, ip: null });
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
  await appendAudit({ action: "quickfix.terms_accepted", actor: acc.customerEmail, targetType: "quickfix_offer", targetId: acc.offerId, meta: { termsVersion: acc.termsVersion, digest: acc.digest }, ip: null });
}
export async function getTermsAcceptance(offerId: string): Promise<TermsAcceptance | null> {
  return (await getState()).terms[offerId] ?? null;
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
