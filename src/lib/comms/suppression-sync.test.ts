import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { insertLead, insertPlan, insertStep, getPlan, isSuppressed, listSuppressions } from "../repo";
import { dispatchStep } from "./dispatch";
import { isHardBounce, syncSuppressionFromDelivery, ensureLeadSuppressed } from "./suppression-sync";
import { handleResendWebhook } from "./webhook";
import { ingestInboundReply } from "./reply";
import { unsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";
import { resetEmailProvider } from "./provider";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); process.env.RESEND_API_KEY = "re_test"; process.env.RESEND_FROM = "J <j@artifexlabs.tech>"; process.env.AUTH_SECRET = "test-secret"; resetEmailProvider(); });
afterEach(() => { global.fetch = realFetch; resetEmailProvider(); vi.restoreAllMocks(); });

async function seedLead(email = "owner@sup.example"): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Sup Co", normalizedName: "supco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: "https://sup.example", websiteDomain: "sup.example",
    publicEmail: email, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}
async function seedSentPlusPending(leadId: string, pmid: string) {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step1 = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s1", content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  const step2 = await insertStep({ planId: plan.id, stepNumber: 2, channel: "email", delayDays: 4, subject: "s2", content: "b2 {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-30T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => ({ id: pmid }), text: async () => "{}" } as unknown as Response)) as unknown as typeof fetch;
  await dispatchStep(step1.id);
  return { plan, step2 };
}

describe("isHardBounce (Phase 6)", () => {
  it("treats hard/permanent as suppressible", () => {
    expect(isHardBounce({ data: { type: "hard" } })).toBe(true);
    expect(isHardBounce({ data: { bounce: { type: "Permanent" } } })).toBe(true);
  });
  it("treats soft/transient as NOT suppressible", () => {
    expect(isHardBounce({ data: { type: "soft" } })).toBe(false);
    expect(isHardBounce({ data: { bounce: { subType: "Transient" } } })).toBe(false);
  });
});

describe("syncSuppressionFromDelivery (Phase 6)", () => {
  it("suppresses on complaint and stops the sequence, blocking future sends", async () => {
    const lead = await seedLead();
    const { plan, step2 } = await seedSentPlusPending(lead.id, "m-c");
    const did = await syncSuppressionFromDelivery({ type: "complained", providerMessageId: "m-c", at: "x" }, {});
    expect(did).toBe(true);
    expect(await isSuppressed({ email: lead.publicEmail })).toBe(true);
    expect((await getPlan(plan.id))!.status).toBe("stopped");

    // Future attempt never sends (sequence stopped + suppression both block it).
    const r = await dispatchStep(step2.id);
    expect(r.outcome).toBe("skipped");
  });

  it("suppresses on hard bounce", async () => {
    const lead = await seedLead("hb@sup.example");
    await seedSentPlusPending(lead.id, "m-hb");
    await syncSuppressionFromDelivery({ type: "bounced", providerMessageId: "m-hb", at: "x" }, { data: { type: "hard" } });
    expect(await isSuppressed({ email: "hb@sup.example" })).toBe(true);
  });

  it("does NOT suppress on a soft bounce", async () => {
    const lead = await seedLead("sb@sup.example");
    await seedSentPlusPending(lead.id, "m-sb");
    const did = await syncSuppressionFromDelivery({ type: "bounced", providerMessageId: "m-sb", at: "x" }, { data: { type: "soft" } });
    expect(did).toBe(false);
    expect(await isSuppressed({ email: "sb@sup.example" })).toBe(false);
  });

  it("is idempotent — no duplicate suppression rows", async () => {
    const lead = await seedLead("id@sup.example");
    await ensureLeadSuppressed(lead.id, "first");
    await ensureLeadSuppressed(lead.id, "second");
    const rows = (await listSuppressions()).filter((s) => s.email === "id@sup.example");
    expect(rows).toHaveLength(1);
  });
});

describe("webhook + reply suppression wiring (Phase 6)", () => {
  it("suppresses end-to-end through the signed webhook on a complaint", async () => {
    const secret = "whsec_" + Buffer.from("s6secret").toString("base64");
    const lead = await seedLead("w6@sup.example");
    await seedSentPlusPending(lead.id, "m-w6");
    const now = new Date("2026-07-15T10:00:00Z");
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "m-w6" } });
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    const sig = createHmac("sha256", key).update(`evt_c.${Math.floor(now.getTime() / 1000)}.${body}`).digest("base64");
    const r = await handleResendWebhook({ rawBody: body, headers: { id: "evt_c", timestamp: String(Math.floor(now.getTime() / 1000)), signature: `v1,${sig}` }, secret, now });
    expect(r.ok).toBe(true);
    expect(await isSuppressed({ email: "w6@sup.example" })).toBe(true);
  });

  it("suppresses on an unsubscribe reply", async () => {
    const lead = await seedLead("u6@sup.example");
    await seedSentPlusPending(lead.id, "m-u6");
    const r = await ingestInboundReply({ from: "u6@sup.example", subject: "re", body: "please unsubscribe me" });
    expect(r.classification).toBe("Unsubscribe");
    expect(await isSuppressed({ email: "u6@sup.example" })).toBe(true);
  });
});

describe("unsubscribe token (Phase 6)", () => {
  it("round-trips a signed token and rejects a bad one", () => {
    const token = unsubscribeToken("lead_123")!;
    expect(verifyUnsubscribeToken("lead_123", token)).toBe(true);
    expect(verifyUnsubscribeToken("lead_123", "deadbeef")).toBe(false);
    expect(verifyUnsubscribeToken("lead_999", token)).toBe(false);
  });
});
