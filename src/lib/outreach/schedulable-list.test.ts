import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { scheduleBatch } from "./scheduled-batch";
import { schedulableEmails } from "./schedulable-list";

const strong = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move leaves.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];

async function seed(name: string, opps: any[]): Promise<string> {
  const slug = name.toLowerCase().replace(/\W/g, "");
  const lead = await insertLead({ businessName: name, normalizedName: slug, industry: "dentist", normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012", phone: "(213) 555-0100", website: `https://${slug}.example`, websiteDomain: `${slug}.example`, publicEmail: `office@${slug}.example`, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 82, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionOverride: false, assignedTo: "jordan" } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = opps;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}

beforeEach(() => __resetStoreForTests());

describe("schedulableEmails — truthful operator list", () => {
  it("classifies SENDABLE → eligible (with staggered proposed times), INSUFFICIENT → not-ready", async () => {
    const a = await seed("Alpha Dental", strong);
    const b = await seed("Bravo Dental", strong);
    const c = await seed("Charlie Dental", []); // INSUFFICIENT
    const v = await schedulableEmails();
    expect(v.eligible.map((e) => e.leadId).sort()).toEqual([a, b].sort());
    expect(v.eligible.every((e) => !!e.proposedAt && e.revisionId.startsWith("rev_") && e.recipient.includes("@"))).toBe(true);
    // proposed times are distinct + strictly ascending within the window (staggered, no burst)
    const times = v.eligible.map((e) => e.proposedAt);
    expect(new Set(times).size).toBe(times.length);
    expect([...times].sort()).toEqual(times.slice().sort());
    expect(v.notReady.some((n) => n.leadId === c && /evidence|supported finding/i.test(n.reason))).toBe(true);
    expect(v.scheduled).toHaveLength(0);
    expect(v.window).toMatchObject({ tz: "America/Los_Angeles", startHour: 5, endHour: 7 }); // resolved from Settings (default production window)
  }, 60000);

  it("a scheduled lead moves from eligible → scheduled (no double-listing)", async () => {
    const a = await seed("Delta Dental", strong);
    await scheduleBatch([a], { dateKey: "2026-08-31", by: "jordan", batchId: "b1", now: "2026-08-28T00:00:00.000Z" });
    const v = await schedulableEmails();
    expect(v.eligible.find((e) => e.leadId === a)).toBeUndefined();
    expect(v.scheduled.map((s) => s.leadId)).toContain(a);
  }, 60000);
});
