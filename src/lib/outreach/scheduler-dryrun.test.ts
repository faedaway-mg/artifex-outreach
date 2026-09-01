import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence, allEmailSends } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { scheduleBatch } from "./scheduled-batch";
import { evaluateScheduledDryRun } from "./scheduler-dryrun";
import { DEFAULT_SENDING_WINDOW } from "./sending-window";

const strongOne = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move leaves.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];

async function seedScheduled(name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\W/g, "");
  const lead = await insertLead({ businessName: name, normalizedName: slug, industry: "dentist", normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012", phone: "(213) 555-0100", website: `https://${slug}.example`, websiteDomain: `${slug}.example`, publicEmail: `office@${slug}.example`, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 82, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionOverride: false, assignedTo: "jordan" } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = strongOne;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  // Schedule for a PAST LA morning so it is already DUE at any "now" we evaluate.
  await scheduleBatch([lead.id], { dateKey: "2026-08-24", by: "jordan", batchId: "b_dry", now: "2026-08-20T00:00:00.000Z", window: { tz: "America/Los_Angeles", startHour: 5, endHour: 7 } });
  return lead.id;
}

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); });
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

describe("scheduler dry-run — structurally incapable of sending", () => {
  it("evaluates a DUE item inside the window and reports wouldSend WITHOUT calling the provider or writing anything", async () => {
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1"; // even with prospect delivery ON, dry-run cannot send
    await seedScheduled("Alpha Dental");
    // Any network call (Resend) during a dry-run is a hard failure.
    const fetchSpy = vi.fn(async () => { throw new Error("dry-run must never touch the network/provider"); });
    global.fetch = fetchSpy as any;

    const before = (await allEmailSends()).length;
    // Monday 2026-08-31 06:00 LA (PDT) = 13:00 UTC — inside the 05:00–07:00 window.
    const res = await evaluateScheduledDryRun(new Date("2026-08-31T13:00:00Z"), DEFAULT_SENDING_WINDOW);

    expect(res.dryRun).toBe(true);
    expect(res.inWindow).toBe(true);
    expect(res.due).toBe(1);
    expect(res.eligible).toBe(1);
    expect(res.wouldSend).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();                 // provider NEVER invoked
    expect((await allEmailSends()).length).toBe(before);     // no ledger row created — zero mutation
    delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED;
  }, 60000);

  it("a cron wake OUTSIDE the LA window reports zero would-sends and never touches the provider", async () => {
    await seedScheduled("Bravo Dental");
    const fetchSpy = vi.fn(async () => { throw new Error("no network in dry-run"); });
    global.fetch = fetchSpy as any;

    // Monday 2026-08-31 08:30 LA (PDT) = 15:30 UTC — a cron wake AFTER the window closes.
    const res = await evaluateScheduledDryRun(new Date("2026-08-31T15:30:00Z"), DEFAULT_SENDING_WINDOW);
    expect(res.dryRun).toBe(true);
    expect(res.inWindow).toBe(false);
    expect(res.wouldSend).toBe(0);
    expect(res.due).toBe(1);
    expect(res.blocked.reasons["outside-window"]).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60000);
});
