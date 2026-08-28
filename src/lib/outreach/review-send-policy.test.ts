import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence, addSuppression, auditForTarget } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { saveDraft, skipReview } from "./review-revisions";
import { authorizeForSend, authorizationValidForDispatch, AUTOSEND_ENV, AUTH_ACTION } from "./review-send-policy";

const ORIG = process.env[AUTOSEND_ENV];

function leadBase(name: string, over: any = {}) {
  return {
    googlePlaceId: null, businessName: name, normalizedName: name.toLowerCase(), industry: "dentist",
    normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: `https://${name.toLowerCase().replace(/\W/g, "")}.example`,
    websiteDomain: `${name.toLowerCase().replace(/\W/g, "")}.example`, publicEmail: `office@${name.toLowerCase().replace(/\W/g, "")}.example`,
    contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL",
    googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "A", leadScore: 82, scoreBreakdown: {},
    pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x",
    recommendationReason: null, opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62,
    acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", assignedAt: null,
    assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  };
}

// opportunities → drive status: strong single (Observed+Foundational) = SENDABLE; Moderate = NEEDS_REVIEW; none = INSUFFICIENT.
async function seed(name: string, opps: any[], over: any = {}): Promise<string> {
  const lead = await insertLead(leadBase(name, over) as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = opps;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}
const strongOne = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move leaves.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];
const moderateOne = [{ id: "m", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "y", estimatedImpact: { level: "Moderate", rationale: "x" }, confidence: { label: "Observed", score: 0.9 }, basis: ["public website HTML"] }];

beforeEach(() => { __resetStoreForTests(); delete process.env[AUTOSEND_ENV]; });
afterEach(() => { if (ORIG === undefined) delete process.env[AUTOSEND_ENV]; else process.env[AUTOSEND_ENV] = ORIG; });

describe("review-send-policy — automated authorization (Gate 4)", () => {
  it("policy DISABLED: a content-SENDABLE unedited review is NOT authorized", async () => {
    const id = await seed("Alpha Dental", strongOne);
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(false);
    expect(r.reason).toMatch(/disabled/i);
  });

  it("policy ENABLED: a SENDABLE unedited review is authorized (type=policy), bound to revision + PDF bytes", async () => {
    process.env[AUTOSEND_ENV] = "1";
    const id = await seed("Bravo Dental", strongOne);
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(true);
    expect(r.auth!.type).toBe("policy");
    expect(r.auth!.revisionId).toMatch(/^rev_/);
    expect(r.auth!.pdfSha256).toHaveLength(64);
    expect(r.auth!.authorizedBy).toBe("qr-autosend");
    // recorded in the append-only audit
    expect((await auditForTarget("lead", id)).some((a) => a.action === AUTH_ACTION)).toBe(true);
  }, 60000);

  it("policy ENABLED: a NEEDS_REVIEW (Moderate) review is NOT policy-authorized — needs an operator", async () => {
    process.env[AUTOSEND_ENV] = "1";
    const id = await seed("Charlie Dental", moderateOne);
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(false);
    expect(r.reason).toMatch(/not policy-eligible|NEEDS_REVIEW/i);
  });

  it("policy ENABLED: an INSUFFICIENT review is NOT authorized", async () => {
    process.env[AUTOSEND_ENV] = "1";
    const id = await seed("Delta Dental", []);
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(false);
  });

  it("a suppressed recipient is never authorized (policy enabled)", async () => {
    process.env[AUTOSEND_ENV] = "1";
    const id = await seed("Echo Dental", strongOne);
    await addSuppression({ email: "office@echodental.example", domain: null, phone: null, reason: "unsubscribe", source: "test" } as any);
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(false);
    expect(r.reason).toMatch(/suppress/i);
  });

  it("a HELD review is never authorized (policy enabled)", async () => {
    process.env[AUTOSEND_ENV] = "1";
    const id = await seed("Foxtrot Dental", strongOne);
    await skipReview(id, "waiting on a better logo", { actor: "jordan" });
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(false);
    expect(r.reason).toMatch(/held/i);
  });

  it("dispatch re-verification: valid when unchanged; INVALID after a later edit (revision drift)", async () => {
    process.env[AUTOSEND_ENV] = "1";
    const id = await seed("Golf Dental", strongOne);
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(true);
    expect((await authorizationValidForDispatch(id, r.auth!)).ok).toBe(true);
    // an edit changes the content revision → the prior authorization is stale
    await saveDraft(id, { openingHook: "A distinct edited hook after authorization." }, { actor: "jordan" });
    const v = await authorizationValidForDispatch(id, r.auth!);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/changed since authorization/i);
  }, 60000);
});
