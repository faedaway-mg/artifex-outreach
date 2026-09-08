// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — quick-fix state lives in the Settings jsonb singleton (like
// sprintSessions): survives deploys, needs no migration, works in prod (Postgres)
// and in the in-memory store. Funnel events are appended to the canonical audit
// log. Offers are keyed by a deterministic offerId (`qfo_<offerVersion>`), so
// regenerating an unchanged offer reuses its record (idempotent by construction).
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings, appendAudit } from "../repo";
import type { QuickFixOffer, JobState, AutomationLevel } from "./types";
import type { EvergreenAssetVersion } from "./evergreen-asset";
import { seedEvergreenExplainer } from "./evergreen-asset";
import type { CommerceRecord, CommerceStore } from "./stripe-commerce";
import type { WebhookDeps, WebhookOutcome } from "./webhook";
import type { TermsAcceptance } from "./terms";
import type { CustomerRecord } from "./lifecycle";
import { DEFAULT_AUTOMATION_LEVEL } from "./automation-policy";

export type ApprovalStatus = "draft" | "approved" | "rejected";

export interface StoredOffer extends QuickFixOffer {
  approvalStatus: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  recipientEmail: string | null;
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
};

export function offerIdFor(offer: QuickFixOffer): string {
  return `qfo_${offer.offerVersion}`;
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
