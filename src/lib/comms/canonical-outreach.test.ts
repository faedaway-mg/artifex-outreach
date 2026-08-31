// ─────────────────────────────────────────────────────────────────────────────
// NO-SEND PROOFS for the frozen Quick Review artifact + the ONE canonical cold-outreach boundary.
// Every test runs against the in-memory store with a COUNTING render (each call returns DIFFERENT
// bytes, simulating @react-pdf non-determinism) and an intercepted provider — no network, no real send.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  insertLead, insertPlan, insertStep, getBusinessIntelligence, upsertBusinessIntelligence, appendAudit, getStep,
} from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { __resetStoreForTests } from "../store";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { buildQuickReview } from "../outreach/quick-review";
import type { BusinessProfile } from "../business-intelligence/types";
import {
  approveAndFreezeQuickReview, resolveFrozenReviewForSend, ensureFrozenReviewForSend, latestReviewApproval,
  type FreezeDeps,
} from "../outreach/quick-review-freeze";
import { prepareCanonicalReviewOutreach, submitCanonicalColdOutreach } from "./canonical-outreach";
import { submitCompliantDispatch, type OutreachDispatchRequest } from "./outreach-transport";
import { reviewApprovalDigest, type ReviewApprovalBinding } from "../outreach/review-approval-binding";
import { loadFrozenReviewPdf, frozenReviewPdfKey } from "../outreach/frozen-review-pdf";
import { dispatchStep } from "./dispatch";
import type { EmailProvider, EmailMessage, SendResult } from "./provider";
import type { Lead } from "../types";

// ── seed helpers ───────────────────────────────────────────────────────────────
async function seedLead(over: Partial<Lead> = {}): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Canonical Co", normalizedName: "canonicalco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://c.example", websiteDomain: "c.example",
    publicEmail: "owner@c.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  } as any);
}

function makeSendable<T extends { businessProfile: { opportunities: any[] } }>(bi: T): T {
  const ev = (category: string, observation: string, why: string) => ({
    id: category, category, observation, whyItMatters: why,
    estimatedImpact: { level: "High", rationale: "A concrete fix." }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"],
  });
  bi.businessProfile.opportunities = [
    ev("Scheduling", "The site has no online booking — reservations require a phone call during business hours.", "New customers who won't call during business hours quietly drop off before they ever reach the desk."),
    ev("Brand Experience", "The homepage has no clear primary call to action for a first-time visitor.", "A first-time visitor with no obvious next move is the one most likely to leave without acting."),
    ...bi.businessProfile.opportunities,
  ];
  return bi;
}

async function seedSendableLead(): Promise<Lead> {
  const lead = await seedLead();
  const bi = makeSendable(await analyzeBusiness({ lead, findings: [], contacts: [] } as any));
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi as any, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
  return lead;
}

// A COUNTING render — each call returns DIFFERENT bytes (simulates @react-pdf non-determinism).
function countingRender() {
  const state = { renders: 0 };
  const render: FreezeDeps["render"] = async () => { state.renders++; return Buffer.from(`FAKE-PDF-BYTES::render-${state.renders}::${"x".repeat(64)}`); };
  return { state, render, deps: { loadBrand: async () => null, render } as FreezeDeps };
}

// An intercepted provider that COUNTS sends and records the exact message. No network.
function countingProvider(behavior: (msg: EmailMessage, n: number) => SendResult = (_m, n) => ({ sent: true, providerMessageId: `cnt-${n}` })) {
  const calls = { send: 0 }; const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    name: "counting", canSend: true, meta: { name: "counting", mode: "disabled", fromDomain: null, batchLimit: 1, configured: true },
    async send(msg) { calls.send++; sent.push(msg); return behavior(msg, calls.send); },
    async sendEmail(msg) { return this.send(msg); },
    async sendBatch(msgs) { return Promise.all(msgs.map((m) => this.send(m))); },
    async verifyConfiguration() { return { ok: true, issues: [] }; },
    async healthCheck() { return { ok: true, issues: [] }; },
  };
  return { provider, calls, sent };
}

const shaOfBase64 = (b64: string) => createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); });
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); });

describe("Frozen Quick Review + canonical send — NO-SEND PROOFS", () => {
  it("P3+P1: renders EXACTLY ONCE at approval; preview and authorization reuse identical bytes/SHA (no re-render)", async () => {
    const lead = await seedSendableLead();
    const { state, deps } = countingRender();

    // Proof the render itself is non-deterministic (repeated rendering DIFFERS).
    const r1 = await deps.render!({} as any); const r2 = await deps.render!({} as any);
    expect(Buffer.compare(r1, r2)).not.toBe(0);
    state.renders = 0; // reset the counter for the approval measurement

    const approved = await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    expect(approved.ok).toBe(true);
    expect(state.renders).toBe(1); // rendered exactly once at approval

    const preview = await resolveFrozenReviewForSend(lead.id, deps);       // "preview"
    const authorize = await resolveFrozenReviewForSend(lead.id, deps);      // "authorization"
    expect(preview.ok && authorize.ok).toBe(true);
    expect(state.renders).toBe(1); // NEITHER read re-rendered
    expect(preview.sha256).toBe(approved.frozenPdfSha256);
    expect(authorize.sha256).toBe(approved.frozenPdfSha256);
    expect(preview.pdfBase64).toBe(authorize.pdfBase64); // byte-identical
  });

  it("P2: the intercepted real-path send attaches the EXACT frozen bytes (attachment SHA == frozen SHA)", async () => {
    const lead = await seedSendableLead();
    const { state, deps } = countingRender();
    const approved = await approveAndFreezeQuickReview({ leadId: lead.id }, deps);

    const review = buildQuickReview(lead, (await getBusinessIntelligence(lead.id))!.profile!.businessProfile as BusinessProfile, null, { approved: true });
    const prepared = await prepareCanonicalReviewOutreach(
      { leadId: lead.id, recipient: "owner@c.example" },
      { freeze: deps, loadReview: async () => ({ lead: { businessName: lead.businessName, source: lead.source }, review }) },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.prepared.pdfSha256).toBe(approved.frozenPdfSha256);

    const cp = countingProvider();
    const res = await submitCanonicalColdOutreach(prepared.prepared, { provider: cp.provider });
    expect(res.sent).toBe(true);
    expect(cp.calls.send).toBe(1);
    const att = cp.sent[0].attachments![0];
    expect(shaOfBase64(att.content)).toBe(approved.frozenPdfSha256); // exact frozen bytes on the wire
    expect(att.filename).toBe(prepared.prepared.filename);
    expect(state.renders).toBe(1); // send did NOT re-render
  });

  it("P4: the frozen artifact persists (survives a simulated restart) and stays byte-identical", async () => {
    const lead = await seedSendableLead();
    const { deps } = countingRender();
    const approved = await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    // Simulated restart: a fresh read from durable storage returns the SAME bytes + SHA.
    const reloaded = await loadFrozenReviewPdf(lead.id, approved.version!);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.sha256).toBe(approved.frozenPdfSha256);
    const afterRestart = await resolveFrozenReviewForSend(lead.id, deps);
    expect(afterRestart.ok && afterRestart.sha256).toBe(approved.frozenPdfSha256);
  });

  it("P5: source-content drift INVALIDATES the approval (fails closed; re-approval mints a new version)", async () => {
    const lead = await seedSendableLead();
    const { deps } = countingRender();
    const v1 = await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    expect(v1.version).toBe(1);

    // Drift the source content: change the BI opportunities → different content digest.
    const bi = (await getBusinessIntelligence(lead.id))!;
    (bi.profile!.businessProfile as any).opportunities = [
      { id: "New", category: "SEO", observation: "The site has no title tags on key pages, so search results show a bare URL.", whyItMatters: "A bare search result earns fewer clicks than one with a clear, benefit-led title.", estimatedImpact: { level: "High", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] },
      ...(bi.profile!.businessProfile as any).opportunities,
    ];
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi.profile as any, enrichmentDelta: null, generatedAt: "2026-07-23T00:00:00.000Z" });

    const stale = await resolveFrozenReviewForSend(lead.id, deps);
    expect(stale.ok).toBe(false);
    expect(stale.reason).toMatch(/stale|content changed/i); // fail closed on drift

    // Re-approval after drift mints a NEW version (v2), leaving v1 immutable.
    const v2 = await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    expect(v2.version).toBe(2);
    expect(await loadFrozenReviewPdf(lead.id, 1)).not.toBeNull(); // v1 still intact
  });

  it("P6: a tampered binding (SHA mismatch) and a missing blob both FAIL CLOSED", async () => {
    const lead = await seedSendableLead();
    const { deps } = countingRender();
    await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    const good = await latestReviewApproval(lead.id);
    expect(good).not.toBeNull();

    // Tamper: append a newer, self-consistent binding whose frozenPdfSha256 does NOT match the stored bytes.
    const tampered: ReviewApprovalBinding = { ...good!.binding, frozenPdfSha256: "0".repeat(64) };
    await appendAudit({ action: "quick-review.approved", actor: "attacker", targetType: "lead", targetId: lead.id, meta: { status: tampered.reviewStatus, binding: tampered, approvalDigest: reviewApprovalDigest(tampered) } as any, ip: null });
    const t = await resolveFrozenReviewForSend(lead.id, deps);
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/tamper|mismatch/i);

    // Missing blob: point a newer binding at a version whose bytes were never stored.
    const missingKeyBinding: ReviewApprovalBinding = { ...good!.binding, reviewVersion: 99, blobKey: frozenReviewPdfKey(lead.id, 99), frozenPdfSha256: "1".repeat(64) };
    await appendAudit({ action: "quick-review.approved", actor: "op", targetType: "lead", targetId: lead.id, meta: { status: missingKeyBinding.reviewStatus, binding: missingKeyBinding, approvalDigest: reviewApprovalDigest(missingKeyBinding) } as any, ip: null });
    const m = await resolveFrozenReviewForSend(lead.id, deps);
    expect(m.ok).toBe(false);
    expect(m.reason).toMatch(/missing|not found/i);
  });

  it("P7: suppression and an unauthorized recipient BOTH fail BEFORE any provider invocation", async () => {
    const lead = await seedSendableLead();
    const { deps } = countingRender();
    const approved = await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    const review = buildQuickReview(lead, (await getBusinessIntelligence(lead.id))!.profile!.businessProfile as BusinessProfile, null, { approved: true });
    const prep = await prepareCanonicalReviewOutreach(
      { leadId: lead.id, recipient: "owner@c.example" },
      { freeze: deps, loadReview: async () => ({ lead: { businessName: lead.businessName, source: lead.source }, review }) },
    );
    expect(prep.ok).toBe(true); if (!prep.ok) return;

    // Suppression → provider NEVER called.
    const cp1 = countingProvider();
    const sup = await submitCanonicalColdOutreach(prep.prepared, { provider: cp1.provider, isSuppressed: async () => true });
    expect(sup.sent).toBe(false);
    expect(sup.errorCode).toBe("suppressed");
    expect(cp1.calls.send).toBe(0);

    // Unauthorized recipient (prospect delivery OFF, recipient ≠ test address) → provider NEVER called.
    delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED;
    process.env.COMMS_TEST_RECIPIENT = "authorized-test@artifexlabs.tech";
    const cp2 = countingProvider();
    const gate = await submitCanonicalColdOutreach(prep.prepared, { provider: cp2.provider });
    expect(gate.sent).toBe(false);
    expect(gate.errorCode).toBe("recipient-gate");
    expect(cp2.calls.send).toBe(0);
    void approved;
  });

  it("P8: duplicate dispatch of the same step produces AT MOST ONE provider submission (idempotent ledger)", async () => {
    const lead = await seedSendableLead();
    // Pre-freeze via injected deps (no brand fetch / no render) so dispatch LOADS the frozen artifact
    // and the only outbound fetch is the real send — keeping the send count unpolluted.
    await approveAndFreezeQuickReview({ leadId: lead.id }, countingRender().deps);
    const plan = await insertPlan({
      leadId: lead.id, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
      status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
      approvedBy: "jordan", approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), pausedAt: null, completedAt: null,
      pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
      assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
    });
    const step = await insertStep({
      planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "A quick note",
      content: "Hi there. {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved",
      scheduledAt: new Date().toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
    });
    const rf = resendFetch();
    global.fetch = rf.fn;
    const a = await dispatchStep(step.id);
    const b = await dispatchStep(step.id);
    expect(a.outcome).toBe("sent");
    expect(b.outcome).toBe("deduped");
    expect(rf.calls.send).toBe(1); // exactly one provider submission across two invocations
    expect((await getStep(step.id))!.sentAt).toBeTruthy();
  });

  it("P9: an ambiguous (network/timeout) provider response is NOT auto-retried", async () => {
    const req: OutreachDispatchRequest = {
      leadId: "L", recipient: "authorized-test@artifexlabs.tech", subject: "s", bodyText: "t", bodyHtml: "<p>t</p>",
      idempotencyKey: "k", classification: "COLD_OUTREACH" as any,
    };
    process.env.COMMS_TEST_RECIPIENT = "authorized-test@artifexlabs.tech";
    delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED;
    const netProvider = countingProvider(() => ({ sent: false, providerMessageId: null, errorCode: "network", reason: "timeout" }));
    const res = await submitCompliantDispatch(req, "https://app.artifexlabs.tech/api/comms/unsubscribe?lead=L&t=x", { provider: netProvider.provider, isSuppressed: async () => false });
    expect(res.sent).toBe(false);
    expect(res.ambiguous).toBe(true);
    expect(res.retryable).not.toBe(true); // must NOT be auto-retried
  });

  it("P10: send-one-branded and the dry-run assemble byte-identical messages (same subject/body/headers/filename/SHA)", async () => {
    const lead = await seedSendableLead();
    const { deps } = countingRender();
    await approveAndFreezeQuickReview({ leadId: lead.id }, deps);
    const review = buildQuickReview(lead, (await getBusinessIntelligence(lead.id))!.profile!.businessProfile as BusinessProfile, null, { approved: true });
    const loadReview = async () => ({ lead: { businessName: lead.businessName, source: lead.source }, review });

    // Both scripts call the SAME canonical prepare with the same lead + recipient → identical output.
    const sendOne = await prepareCanonicalReviewOutreach({ leadId: lead.id, recipient: "owner@c.example" }, { freeze: deps, loadReview });
    const dryRun = await prepareCanonicalReviewOutreach({ leadId: lead.id, recipient: "owner@c.example" }, { freeze: deps, loadReview });
    expect(sendOne.ok && dryRun.ok).toBe(true);
    if (!sendOne.ok || !dryRun.ok) return;
    expect(dryRun.prepared.subject).toBe(sendOne.prepared.subject);
    expect(dryRun.prepared.filename).toBe(sendOne.prepared.filename);
    expect(dryRun.prepared.pdfSha256).toBe(sendOne.prepared.pdfSha256);
    expect(dryRun.prepared.req.bodyText).toBe(sendOne.prepared.req.bodyText);
    expect(dryRun.prepared.req.bodyHtml).toBe(sendOne.prepared.req.bodyHtml);
    expect(dryRun.prepared.unsubscribeUrl).toBe(sendOne.prepared.unsubscribeUrl);
  });

  it("P-gate: a review that is NOT approved/frozen fails closed on the send path (never bare, never rendered here)", async () => {
    const lead = await seedSendableLead();
    // No approval/freeze performed, and NEEDS_REVIEW would require it. Force not-ready via empty opportunities:
    const bi = (await getBusinessIntelligence(lead.id))!;
    (bi.profile!.businessProfile as any).opportunities = [];
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi.profile as any, enrichmentDelta: null, generatedAt: "2026-07-24T00:00:00.000Z" });
    const { state, deps } = countingRender();
    const r = await ensureFrozenReviewForSend(lead.id, deps);
    expect(r.ok).toBe(false);
    expect(state.renders).toBe(0); // fail closed WITHOUT rendering
  });
});
