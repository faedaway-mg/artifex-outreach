import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence, isSuppressed } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { getEditorialState } from "../outreach/review-revisions";
import { scheduleBatch } from "../outreach/scheduled-batch";
import { suppressAndCascade, isEmailSuppressed } from "./suppression";

const strong = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "leaves", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];
async function seed(name: string, email: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\W/g, "");
  const lead = await insertLead({ businessName: name, normalizedName: slug, industry: "dentist", normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012", phone: "(213) 555-0100", website: `https://${slug}.example`, websiteDomain: `${slug}.example`, publicEmail: email, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 82, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionOverride: false, assignedTo: "jordan" } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = strong;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}

beforeEach(() => __resetStoreForTests());

describe("suppressAndCascade — permanent global opt-out + cascade cancel", () => {
  it("suppresses the address globally AND cancels a scheduled message for that lead", async () => {
    const id = await seed("Alpha Dental", "office@alpha.example");
    await scheduleBatch([id], { dateKey: "2026-08-31", by: "jordan", batchId: "b1", now: "2026-08-28T00:00:00.000Z" });
    expect((await getEditorialState(id)).scheduled?.status).toBe("scheduled");

    const r = await suppressAndCascade({ email: "office@alpha.example", leadId: id, status: "UNSUBSCRIBED", source: "one-click" });
    expect(r.alreadySuppressed).toBe(false);
    expect(r.scheduledCancelled).toBe(true);
    expect(await isEmailSuppressed("office@alpha.example")).toBe(true);
    expect((await getEditorialState(id)).scheduled).toBeNull(); // scheduled message cancelled
  }, 60000);

  it("is idempotent + case/whitespace normalized (a re-click stays suppressed, no error)", async () => {
    await seed("Bravo Dental", "Owner@Bravo.example");
    const first = await suppressAndCascade({ email: "owner@bravo.example", status: "UNSUBSCRIBED", source: "one-click" });
    expect(first.alreadySuppressed).toBe(false);
    const again = await suppressAndCascade({ email: "  OWNER@BRAVO.EXAMPLE ", status: "UNSUBSCRIBED", source: "one-click" });
    expect(again.alreadySuppressed).toBe(true);
    expect(await isEmailSuppressed("owner@bravo.example")).toBe(true);
    expect(await isSuppressed({ email: "owner@bravo.example" })).toBe(true);
  }, 60000);

  it("resolves the lead by email when leadId is not supplied (webhook/import path)", async () => {
    const id = await seed("Charlie Dental", "hi@charlie.example");
    await scheduleBatch([id], { dateKey: "2026-08-31", by: "jordan", batchId: "b2", now: "2026-08-28T00:00:00.000Z" });
    const r = await suppressAndCascade({ email: "hi@charlie.example", status: "DO_NOT_CONTACT", source: "reply" }); // no leadId
    expect(r.scheduledCancelled).toBe(true);
    expect((await getEditorialState(id)).scheduled).toBeNull();
  }, 60000);
});
