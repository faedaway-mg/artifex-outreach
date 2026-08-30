import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { insertLead, insertPlan, insertStep, allEmailEvents } from "../repo";
import { dispatchStep } from "./dispatch";
import { getEmailSendByProviderMessageId } from "../repo";
import { verifySvixSignature, parseResendEvent, handleResendWebhook } from "./webhook";
import { applyDeliveryEvent } from "./events";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); }); // cold outreach delivers via the compliant Resend transport
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); });

// The seeded send now leaves via Resend, whose providerMessageId is the REAL Resend id `resend-<n>`
// (first success = "resend-1"). The webhook payloads reference THAT id, so we return the recorded pmid
// for the caller to post back. (The `providerMessageId` arg is now ignored — kept for call-site parity.)
async function seedSentStep(_providerMessageId = "m1"): Promise<{ pmid: string }> {
  const lead: Lead = await insertLead({
    googlePlaceId: null, businessName: "Hook Co", normalizedName: "hookco", industry: "Auto repair",
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
  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s", content: "b {{unsubscribe}}",
    approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
  global.fetch = resendFetch().fn;
  const r = await dispatchStep(step.id);
  return { pmid: r.providerMessageId! }; // Resend records the real message id (e.g. "resend-1")
}

function signed(secret: string, id: string, body: string, tsSec: number): { headers: any } {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${tsSec}.${body}`).digest("base64");
  return { headers: { id, timestamp: String(tsSec), signature: `v1,${sig}` } };
}

describe("verifySvixSignature (Phase 4)", () => {
  const secret = "whsec_" + Buffer.from("supersecretkey").toString("base64");
  it("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const now = new Date("2026-07-15T10:00:00Z");
    const { headers } = signed(secret, "msg_1", body, Math.floor(now.getTime() / 1000));
    expect(verifySvixSignature(secret, headers, body, { now })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    const { headers } = signed(secret, "msg_1", "{}", Math.floor(now.getTime() / 1000));
    expect(verifySvixSignature(secret, headers, "{\"x\":1}", { now })).toBe(false);
  });
  it("rejects a stale timestamp (replay guard)", () => {
    const body = "{}";
    const signTime = new Date("2026-07-15T10:00:00Z");
    const { headers } = signed(secret, "msg_1", body, Math.floor(signTime.getTime() / 1000));
    const later = new Date("2026-07-15T11:00:00Z"); // 1h later > 5m tolerance
    expect(verifySvixSignature(secret, headers, body, { now: later })).toBe(false);
  });
});

describe("parseResendEvent (Phase 4)", () => {
  it("maps a delivered event", () => {
    const e = parseResendEvent({ type: "email.delivered", created_at: "2026-07-15T10:00:00Z", data: { email_id: "m9" } });
    expect(e).toMatchObject({ type: "delivered", providerMessageId: "m9" });
  });
  it("ignores non-state events (email.sent)", () => {
    expect(parseResendEvent({ type: "email.sent", data: { email_id: "m9" } })).toBeNull();
  });
});

describe("applyDeliveryEvent — state only, monotonic (Phase 4)", () => {
  it("advances a sent send to delivered → opened → clicked and stamps timestamps", async () => {
    const { pmid } = await seedSentStep("m1");
    await applyDeliveryEvent({ type: "delivered", providerMessageId: pmid, at: "2026-07-15T10:00:00Z" });
    await applyDeliveryEvent({ type: "opened", providerMessageId: pmid, at: "2026-07-15T10:05:00Z" });
    await applyDeliveryEvent({ type: "clicked", providerMessageId: pmid, at: "2026-07-15T10:06:00Z" });
    const send = await getEmailSendByProviderMessageId(pmid);
    expect(send!.status).toBe("clicked");
    expect(send!.deliveredAt).toBeTruthy();
    expect(send!.openedAt).toBeTruthy();
    expect(send!.clickedAt).toBeTruthy();
  });
  it("does not downgrade a clicked send when a late delivered arrives", async () => {
    const { pmid } = await seedSentStep("m2");
    await applyDeliveryEvent({ type: "clicked", providerMessageId: pmid, at: "2026-07-15T10:06:00Z" });
    await applyDeliveryEvent({ type: "delivered", providerMessageId: pmid, at: "2026-07-15T10:00:00Z" });
    const send = await getEmailSendByProviderMessageId(pmid);
    expect(send!.status).toBe("clicked");
    expect(send!.deliveredAt).toBeTruthy(); // still stamped
  });
  it("returns unmatched for an unknown provider message id", async () => {
    expect((await applyDeliveryEvent({ type: "opened", providerMessageId: "nope", at: "x" })).result).toBe("unmatched");
  });
});

describe("handleResendWebhook — dedup + apply (Phase 4)", () => {
  const secret = "whsec_" + Buffer.from("hooksecret").toString("base64");
  it("verifies, applies, and dedupes duplicate deliveries", async () => {
    const { pmid } = await seedSentStep("m3");
    const now = new Date("2026-07-15T10:00:00Z");
    const body = JSON.stringify({ type: "email.opened", created_at: "2026-07-15T10:00:00Z", data: { email_id: pmid } });
    const { headers } = signed(secret, "evt_1", body, Math.floor(now.getTime() / 1000));

    const r1 = await handleResendWebhook({ rawBody: body, headers, secret, now });
    expect(r1).toMatchObject({ ok: true, status: 200, result: "applied" });
    const send1 = await getEmailSendByProviderMessageId(pmid);
    expect(send1!.status).toBe("opened");

    // Same event id again → duplicate, no double-processing.
    const r2 = await handleResendWebhook({ rawBody: body, headers, secret, now });
    expect(r2.result).toBe("duplicate");
    expect(await allEmailEvents()).toHaveLength(1);
  });
  it("rejects an invalid signature with 401", async () => {
    const now = new Date("2026-07-15T10:00:00Z");
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "x" } });
    const r = await handleResendWebhook({ rawBody: body, headers: { id: "e", timestamp: String(Math.floor(now.getTime() / 1000)), signature: "v1,deadbeef" }, secret, now });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
  it("fails closed in production when no secret is configured", async () => {
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "x" } });
    const r = await handleResendWebhook({ rawBody: body, headers: { id: "e", timestamp: "1", signature: null }, secret: null, isProduction: true });
    expect(r).toMatchObject({ ok: false, status: 401, kind: "no_secret" });
  });
});
