import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence, addSuppression } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { getEditorialState, saveDraft } from "./review-revisions";
import { scheduleBatch, cancelScheduled, validateScheduled, staggeredTimes, dueScheduled } from "./scheduled-batch";

const MON = "2026-08-31"; // the target Monday (PDT, UTC-7)
const strongOne = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move leaves.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];
const moderateOne = [{ id: "m", category: "Customer Acquisition", observation: "The site has no online booking; reservations need a phone call.", whyItMatters: "After-hours demand slips.", estimatedImpact: { level: "Moderate", rationale: "x" }, confidence: { label: "Observed", score: 0.9 }, basis: ["public website HTML"] }];

async function seed(name: string, opps: any[], over: any = {}): Promise<string> {
  const slug = name.toLowerCase().replace(/\W/g, "");
  const lead = await insertLead({ businessName: name, normalizedName: slug, industry: "dentist", normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012", phone: "(213) 555-0100", website: `https://${slug}.example`, websiteDomain: `${slug}.example`, publicEmail: `office@${slug}.example`, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 82, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionOverride: false, assignedTo: "jordan", ...over } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = opps;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}

beforeEach(() => { __resetStoreForTests(); });

describe("staggeredTimes — Monday 08:00–10:00 America/Los_Angeles", () => {
  it("produces N distinct, ascending instants inside the window (DST-correct, PDT=UTC-7)", () => {
    const t = staggeredTimes(MON, 10);
    expect(t).toHaveLength(10);
    expect(new Set(t).size).toBe(10);
    expect(t[0]).toBe("2026-08-31T15:00:00.000Z");                 // 08:00 LA = 15:00Z (PDT)
    for (let i = 1; i < t.length; i++) expect(t[i] > t[i - 1]).toBe(true);
    const last = new Date(t[9]).getTime();
    expect(last).toBeLessThan(Date.parse("2026-08-31T17:00:00.000Z")); // strictly before 10:00 LA
  });
});

describe("scheduleBatch — only eligible packages; version-bound; staggered; cancellable", () => {
  it("schedules SENDABLE leads with a bound package, REMOVES ineligible ones (no padding)", async () => {
    const a = await seed("Alpha Dental", strongOne);
    const b = await seed("Bravo Dental", strongOne);
    const insuff = await seed("Charlie Dental", []);        // INSUFFICIENT → removed
    const mod = await seed("Delta Dental", moderateOne);    // NEEDS_REVIEW unapproved → removed
    const res = await scheduleBatch([a, b, insuff, mod], { dateKey: MON, by: "jordan", batchId: "batch_1", now: "2026-08-28T00:00:00.000Z" });
    expect(res.scheduled.map((s) => s.leadId).sort()).toEqual([a, b].sort());
    expect(res.removed.map((r) => r.leadId).sort()).toEqual([insuff, mod].sort());
    // staggered + bound
    expect(res.scheduled[0].scheduledAt).toBe("2026-08-31T15:00:00.000Z");
    expect(res.scheduled[0].pdfSha256).toHaveLength(64);
    const st = await getEditorialState(a);
    expect(st.scheduled?.status).toBe("scheduled");
    expect(st.scheduled?.batchId).toBe("batch_1");
    expect(st.scheduled?.recipient).toBe("office@alphadental.example");
  }, 60000);

  it("validateScheduled: ok when unchanged; INVALID after an edit (revision drift) or suppression", async () => {
    const a = await seed("Echo Dental", strongOne);
    const res = await scheduleBatch([a], { dateKey: MON, by: "jordan", batchId: "b2", now: "2026-08-28T00:00:00.000Z" });
    const binding = (await getEditorialState(a)).scheduled!;
    expect((await validateScheduled(a, binding)).ok).toBe(true);
    // an edit changes the content fingerprint → the scheduled item is stale
    await saveDraft(a, { openingHook: "A distinct edited hook after scheduling." }, { actor: "jordan" });
    const v = await validateScheduled(a, binding);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/changed since scheduling/i);
  }, 60000);

  it("suppression after scheduling invalidates the scheduled item at the boundary", async () => {
    const a = await seed("Foxtrot Dental", strongOne);
    await scheduleBatch([a], { dateKey: MON, by: "jordan", batchId: "b3", now: "2026-08-28T00:00:00.000Z" });
    const binding = (await getEditorialState(a)).scheduled!;
    await addSuppression({ email: "office@foxtrotdental.example", domain: null, phone: null, reason: "unsubscribe", source: "test" } as any);
    expect((await validateScheduled(a, binding)).ok).toBe(false);
  }, 60000);

  it("cancel clears the scheduled item before dispatch", async () => {
    const a = await seed("Golf Dental", strongOne);
    await scheduleBatch([a], { dateKey: MON, by: "jordan", batchId: "b4", now: "2026-08-28T00:00:00.000Z" });
    expect((await getEditorialState(a)).scheduled?.status).toBe("scheduled");
    expect(await cancelScheduled(a)).toBe(true);
    expect((await getEditorialState(a)).scheduled).toBeNull();
  }, 60000);

  it("dueScheduled returns items at/after their staggered time, none before", async () => {
    const a = await seed("Hotel Dental", strongOne);
    await scheduleBatch([a], { dateKey: MON, by: "jordan", batchId: "b5", now: "2026-08-28T00:00:00.000Z" });
    expect(await dueScheduled(new Date("2026-08-31T14:59:00.000Z"))).toHaveLength(0); // before 08:00 LA
    expect(await dueScheduled(new Date("2026-08-31T15:30:00.000Z"))).toHaveLength(1); // after 08:00 LA
  }, 60000);
});
