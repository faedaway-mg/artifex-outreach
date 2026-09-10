import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listUnsubscribeHeaders } from "./unsubscribe";
import { insertLead, insertPlan, insertStep } from "../repo";
import { dispatchStep } from "./dispatch";
import { configureResendTestEnv, clearResendTestEnv, resendFetch, sentMime } from "./resend-test-harness";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); delete process.env.PUBLIC_BASE_URL; });

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
  // Cold send rides the Google Workspace lanes: List-Unsubscribe is derived from the hardened,
  // recipient-bound URL by the compliant transport and rides as a header in the Gmail MIME message
  // (COMMS_UNSUBSCRIBE_SECRET + PUBLIC_BASE_URL come from configureResendTestEnv).
  beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); });

  it("carries compliant List-Unsubscribe headers on the outbound message", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
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
    expect(rf.calls.send).toBe(1);
    const mime = sentMime(rf.calls, 1);
    // The recipient-bound one-click unsubscribe URL rides as the List-Unsubscribe header in the MIME.
    expect(mime).toMatch(/List-Unsubscribe: <https:\/\/[^>\r\n]*\/api\/comms\/unsubscribe\?lead=[^>\r\n]+>/);
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });
});
