import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence, updateSettings } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { authorizeForSend, authorizationValidForDispatch, AUTOSEND_ENV } from "./review-send-policy";
import { effectiveReviewFor, revisionFingerprint } from "./review-revisions";

const ORIG = process.env[AUTOSEND_ENV];
const strongOne = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move leaves.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];

async function seed(name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\W/g, "");
  const lead = await insertLead({ businessName: name, normalizedName: slug, industry: "dentist", normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012", phone: "(213) 555-0100", website: `https://${slug}.example`, websiteDomain: `${slug}.example`, publicEmail: `office@${slug}.example`, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 82, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionOverride: false, assignedTo: "jordan" } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = strongOne;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}

beforeEach(() => { __resetStoreForTests(); process.env[AUTOSEND_ENV] = "1"; });
afterEach(() => { if (ORIG === undefined) delete process.env[AUTOSEND_ENV]; else process.env[AUTOSEND_ENV] = ORIG; });

describe("CTA destination is bound into the revision fingerprint (artifact integrity)", () => {
  it("the resolved booking URL appears on the built review's CTA", async () => {
    const id = await seed("Alpha Dental");
    const eff = await effectiveReviewFor(id);
    expect(eff!.review.cta?.bookingUrl).toBe("https://cal.com/artifex-labs-ob2qbv/30min"); // default canonical
  });

  it("changing the booking destination invalidates a prior authorization (fail closed)", async () => {
    const id = await seed("Bravo Dental");
    const r = await authorizeForSend(id, { campaignId: "c1" });
    expect(r.authorized).toBe(true);
    expect((await authorizationValidForDispatch(id, r.auth!)).ok).toBe(true);

    // Operator repoints the canonical scheduling URL — the customer-facing artifact changed.
    await updateSettings({ calendarLink: "https://cal.com/artifex-labs-ob2qbv/intro" });

    const v = await authorizationValidForDispatch(id, r.auth!);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/changed since authorization/i);
  }, 60000);

  it("the fingerprint itself differs when only the CTA URL differs", async () => {
    const id = await seed("Charlie Dental");
    const before = (await effectiveReviewFor(id))!.review;
    const fpBefore = revisionFingerprint(before);
    const after = { ...before, cta: before.cta ? { ...before.cta, bookingUrl: "https://cal.com/artifex-labs-ob2qbv/intro" } : null };
    expect(revisionFingerprint(after)).not.toBe(fpBefore);
  });
});
