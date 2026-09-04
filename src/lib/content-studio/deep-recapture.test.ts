// Deep-recapture orchestrator — the NO-NETWORK guarantees: ineligible companies are never touched, and the
// bounded state machine blocks non-due leads. (The live crawl → narration → chain path is proven in
// production acceptance, not here — it requires real outbound HTTP.)
import { describe, it, expect, beforeEach } from "vitest";
import { runDeepRecapture } from "./deep-recapture";
import { RECAPTURE_ACTION, MAX_RECAPTURE_ATTEMPTS, type RecaptureAttemptRecord } from "./recapture-state";
import { insertLead, insertEmailSendIfAbsent, appendAudit } from "../repo";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

function leadSeed(over: Partial<Lead> = {}): any {
  return {
    googlePlaceId: null, businessName: "Recapture Co", normalizedName: "recaptureco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://r.example", websiteDomain: "r.example",
    publicEmail: "hello@r.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "google-places", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
    ...over,
  };
}
async function markContacted(leadId: string) {
  await insertEmailSendIfAbsent({
    idempotencyKey: `step:${leadId}:1`, stepId: "s1", planId: null, leadId, toAddr: "hello@r.example", fromAddr: "me@artifexlabs.tech",
    subject: "Hi", status: "sent" as any, provider: "resend", providerMessageId: "m1", attempts: 1, lastError: null, lastErrorCode: null,
    nextAttemptAt: null, queuedAt: null, sendingAt: null, sentAt: "2026-09-01T00:00:00Z", deliveredAt: null, openedAt: null, clickedAt: null,
    bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  } as any);
}
async function recordState(rec: RecaptureAttemptRecord) {
  await appendAudit({ action: RECAPTURE_ACTION, actor: "system", targetType: "lead", targetId: rec.leadId, meta: { rec } as any, ip: null });
}

beforeEach(() => { __resetStoreForTests(); });

describe("runDeepRecapture — eligibility + state gating (no network)", () => {
  it("a CONTACTED company is never eligible and never crawled", async () => {
    const lead = await insertLead(leadSeed());
    await markContacted(lead.id);
    const res = await runDeepRecapture({ leadIds: [lead.id], now: new Date("2026-09-04T12:00:00Z") });
    expect(res.eligible).toBe(0);
    expect(res.attempted).toBe(0);
    expect(res.outcomes).toHaveLength(0);
  });

  it("an eligible company with a TERMINAL recapture state is not attempted again", async () => {
    const lead = await insertLead(leadSeed());
    await recordState({ leadId: lead.id, attempt: 1, at: "2026-09-01T00:00:00Z", outcome: "VOICEOVER_READY", reason: "ok", nextAttemptAt: null });
    const res = await runDeepRecapture({ leadIds: [lead.id], now: new Date("2026-09-04T12:00:00Z") });
    expect(res.eligible).toBe(1);
    expect(res.attempted).toBe(0);
    expect(Object.keys(res.skipped).some((k) => k.startsWith("terminal:"))).toBe(true);
  });

  it("an eligible company with a FUTURE retry is not yet due", async () => {
    const lead = await insertLead(leadSeed());
    await recordState({ leadId: lead.id, attempt: 1, at: "2026-09-04T00:00:00Z", outcome: "RETRY_SCHEDULED", reason: "narration:too_short", nextAttemptAt: "2026-09-05T00:00:00Z" });
    const res = await runDeepRecapture({ leadIds: [lead.id], now: new Date("2026-09-04T12:00:00Z") });
    expect(res.eligible).toBe(1);
    expect(res.attempted).toBe(0);
    expect(res.skipped["not-due"]).toBe(1);
  });

  it("an eligible company that already hit MAX attempts is not attempted", async () => {
    const lead = await insertLead(leadSeed());
    await recordState({ leadId: lead.id, attempt: MAX_RECAPTURE_ATTEMPTS, at: "2026-09-04T00:00:00Z", outcome: "AUTOMATICALLY_EXCLUDED", reason: "exhausted", nextAttemptAt: null });
    const res = await runDeepRecapture({ leadIds: [lead.id], now: new Date("2026-09-04T12:00:00Z") });
    expect(res.attempted).toBe(0);
  });
});
