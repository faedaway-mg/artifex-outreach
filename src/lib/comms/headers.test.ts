import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listUnsubscribeHeaders } from "./unsubscribe";
import { insertLead, insertPlan, insertStep } from "../repo";
import { dispatchStep } from "./dispatch";
import { resetEmailProvider } from "./provider";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; resetEmailProvider(); vi.restoreAllMocks(); delete process.env.PUBLIC_BASE_URL; });

describe("listUnsubscribeHeaders (Phase 7 deliverability)", () => {
  it("includes a one-click HTTPS link + mailto when a public base + secret are set", () => {
    process.env.AUTH_SECRET = "secret";
    process.env.PUBLIC_BASE_URL = "https://outreach.artifexlabs.tech";
    const h = listUnsubscribeHeaders("lead_1", "hello@artifexlabs.tech");
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/outreach\.artifexlabs\.tech\/api\/comms\/unsubscribe\?lead=lead_1&token=[a-f0-9]+>, <mailto:hello@artifexlabs\.tech\?subject=unsubscribe>$/);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("falls back to mailto-only (no One-Click) without a public base", () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.AUTH_SECRET = "secret";
    const h = listUnsubscribeHeaders("lead_1", "hello@artifexlabs.tech");
    expect(h["List-Unsubscribe"]).toBe("<mailto:hello@artifexlabs.tech?subject=unsubscribe>");
    expect(h["List-Unsubscribe-Post"]).toBeUndefined();
  });
});

describe("dispatch attaches List-Unsubscribe to the outbound message", () => {
  beforeEach(() => { __resetStoreForTests(); process.env.RESEND_API_KEY = "re_test"; process.env.RESEND_FROM = "J <j@artifexlabs.tech>"; process.env.AUTH_SECRET = "secret"; process.env.PUBLIC_BASE_URL = "https://outreach.artifexlabs.tech"; resetEmailProvider(); });

  it("passes compliant headers through to the provider payload", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "m" }), text: async () => "{}" } as unknown as Response));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead: Lead = await insertLead({
      googlePlaceId: null, businessName: "Hdr Co", normalizedName: "hdrco", industry: "Auto repair",
      normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
      latitude: null, longitude: null, phone: null, website: "https://h.example", websiteDomain: "h.example",
      publicEmail: "owner@h.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
      businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
      scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
      recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
      acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
      assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
    } as any);
    const plan = await insertPlan({
      leadId: lead.id, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
      status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
      approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
      pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
      assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
    });
    const step = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s", content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
    await dispatchStep(step.id);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.headers["List-Unsubscribe"]).toContain("/api/comms/unsubscribe?lead=");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
