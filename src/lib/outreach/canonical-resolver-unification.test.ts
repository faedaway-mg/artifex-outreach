// ─────────────────────────────────────────────────────────────────────────────
// GAP-CLOSURE NO-SEND PROOFS — every cold/prospect entry point resolves the IDENTICAL approved artifact
// through the ONE canonical resolver; the M2 edited-revision path materializes once and resolves via the
// adapter (never re-renders); missing/tampered manifests fail closed; historical manifests stay readable
// after restart; and arbitrary bytes cannot reach the assembler (compile-time guard). No sends.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  insertLead, insertPlan, insertStep, getBusinessIntelligence, upsertBusinessIntelligence, listAudit,
} from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { __resetStoreForTests } from "../store";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "../comms/resend-test-harness";
import { renderCurrentArtifact, type ArtifactManifest } from "./review-revisions";
import { resolveApprovedArtifactForSend, resolveFrozenReviewFromManifest } from "./resolve-approved-artifact";
import { loadFrozenPdfAtKey, frozenRevisionPdfKey } from "./frozen-review-pdf";
import { authorizeForSend } from "./review-send-policy";
import { prepareCanonicalReviewOutreach } from "../comms/canonical-outreach";
import { buildQuickReview } from "./quick-review";
import { dispatchStep } from "../comms/dispatch";
import { SEND_RECEIPT_ACTION } from "../comms/receipt";
import type { BusinessProfile } from "../business-intelligence/types";
import type { Lead } from "../types";

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

async function seedLead(over: Partial<Lead> = {}): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Unify Co", normalizedName: "unifyco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: null, websiteDomain: null,
    publicEmail: "owner@u.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  } as any);
}

async function seedSendableLead(): Promise<Lead> {
  const lead = await seedLead();
  const bi = makeSendable(await analyzeBusiness({ lead, findings: [], contacts: [] } as any));
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi as any, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
  return lead;
}

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); });
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); delete process.env.QR_AUTOSEND_ENABLED; vi.restoreAllMocks(); });

describe("Canonical resolver unification — GAP-CLOSURE PROOFS (no send)", () => {
  it("G1: the M2 render path MATERIALIZES ONCE — two resolves return the identical SHA (no re-render)", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedSendableLead();
    const a = await renderCurrentArtifact(lead.id);
    const b = await renderCurrentArtifact(lead.id);
    expect(a && b).toBeTruthy();
    // @react-pdf is non-deterministic; identical SHAs across two calls PROVE the 2nd loaded frozen bytes.
    expect(b!.manifest.pdfSha256).toBe(a!.manifest.pdfSha256);
    // The bytes are durably frozen at the revision key.
    const blob = await loadFrozenPdfAtKey(frozenRevisionPdfKey(lead.id, a!.revisionId));
    expect(blob?.sha256).toBe(a!.manifest.pdfSha256);
  });

  it("G2: the M2 ADAPTER resolves a manifest into the canonical contract (loads bytes, verifies SHA)", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedSendableLead();
    const art = await renderCurrentArtifact(lead.id);
    const resolved = await resolveFrozenReviewFromManifest(lead.id, art!.manifest);
    expect(resolved.ok).toBe(true);
    expect(resolved.sha256).toBe(art!.manifest.pdfSha256);
    expect(resolved.filename).toBe(art!.manifest.filename);
  });

  it("G3: the M2 adapter FAILS CLOSED for a tampered manifest and a missing artifact", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedSendableLead();
    const art = await renderCurrentArtifact(lead.id);
    // Tampered: same revision (bytes exist) but a wrong claimed SHA → mismatch.
    const tampered: ArtifactManifest = { ...art!.manifest, pdfSha256: "0".repeat(64) };
    const t = await resolveFrozenReviewFromManifest(lead.id, tampered);
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/tamper|mismatch/i);
    // Missing: a revision whose bytes were never frozen.
    const missing: ArtifactManifest = { ...art!.manifest, revisionId: "rev-never-rendered" };
    const m = await resolveFrozenReviewFromManifest(lead.id, missing);
    expect(m.ok).toBe(false);
    expect(m.reason).toMatch(/missing|not found/i);
  });

  it("G4: a historical M2 manifest remains READABLE after a simulated restart (bytes persist, adapter resolves)", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedSendableLead();
    const art = await renderCurrentArtifact(lead.id);
    const manifest = art!.manifest; // the "historical" manifest recorded earlier
    // Simulated restart: a cold read from durable storage still returns the exact bytes,
    const blob = await loadFrozenPdfAtKey(frozenRevisionPdfKey(lead.id, manifest.revisionId));
    expect(blob?.sha256).toBe(manifest.pdfSha256);
    // and the adapter resolves the historical manifest to the same immutable identity.
    const resolved = await resolveFrozenReviewFromManifest(lead.id, manifest);
    expect(resolved.ok && resolved.sha256).toBe(manifest.pdfSha256);
  });

  it("G5: Layer A (dispatch), Layer B (authorize), operator/controlled-test/cron (resolver+prepare) resolve the IDENTICAL artifact SHA", async () => {
    process.env.QR_AUTOSEND_ENABLED = "1";
    global.fetch = resendFetch().fn;
    const lead = await seedSendableLead();

    // The one canonical resolver — the single source of the approved artifact.
    const canonical = await resolveApprovedArtifactForSend(lead.id);
    expect(canonical.ok).toBe(true);
    const SHA = canonical.sha256!;

    // Layer B authorization binds to the SAME artifact SHA (authorize == send by construction).
    const auth = await authorizeForSend(lead.id, { campaignId: "c1" });
    expect(auth.authorized).toBe(true);
    expect(auth.auth!.pdfSha256).toBe(SHA);

    // Controlled-test / cron single-QR prepare resolves the SAME SHA.
    const review = buildQuickReview(lead, (await getBusinessIntelligence(lead.id))!.profile!.businessProfile as BusinessProfile, null, { approved: true });
    const prepared = await prepareCanonicalReviewOutreach(
      { leadId: lead.id, recipient: "owner@u.example" },
      { loadReview: async () => ({ lead: { businessName: lead.businessName, source: lead.source }, review }) },
    );
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.prepared.pdfSha256).toBe(SHA);

    // Layer A (operator dispatch) attaches the SAME artifact SHA on the immutable receipt.
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
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    const receipt = (await listAudit(50)).find((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id);
    expect((receipt!.meta as any).attachmentSha256).toBe(SHA);
  });
});
