import { describe, it, expect, beforeEach } from "vitest";
import { flagForManualFollowUpAction } from "./attention-actions";
import { attentionAck, MANUAL_FOLLOWUP_FLAG_ACTION } from "./attention-status";
import { insertLead, allEmailSends, listAudit } from "../repo";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

function seed(): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Morris Automotive", normalizedName: "morrisauto", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://m.example", websiteDomain: "m.example",
    publicEmail: "hi@m.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "google-places", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}

beforeEach(() => { __resetStoreForTests(); });

describe("NEEDS_ATTENTION recovery — safe, non-sending (mandate 15 Part 3)", () => {
  it("(6/7) flagging records operator intent and sends NOTHING", async () => {
    const lead = await seed();
    const before = (await allEmailSends()).length;
    const r = await flagForManualFollowUpAction(lead.id);
    expect(r.ok).toBe(true);
    // no email send row was created — the action cannot contact a recipient
    expect((await allEmailSends()).length).toBe(before);
    const audit = await listAudit(5000);
    expect(audit.some((a) => a.action === MANUAL_FOLLOWUP_FLAG_ACTION && a.targetId === lead.id)).toBe(true);
  });

  it("attentionAck reflects the flag (presentation only, no canonical state change)", async () => {
    const lead = await seed();
    expect(await attentionAck(lead.id)).toBeNull();
    await flagForManualFollowUpAction(lead.id);
    expect(await attentionAck(lead.id)).toBe("flagged");
  });

  it("a lead with no acknowledgement returns null (stays in the active attention queue)", async () => {
    const lead = await seed();
    expect(await attentionAck(lead.id)).toBeNull();
  });
});
