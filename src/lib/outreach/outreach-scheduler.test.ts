import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests, db as mem } from "../store";
import { insertLead, upsertBusinessIntelligence, addSuppression } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { skipReview } from "./review-revisions";
import { AUTOSEND_ENV } from "./review-send-policy";
import { setOutreachPaused, PAUSE_ENV } from "./outreach-pause";
import { countSlotsUsed } from "../comms/send-quota";
import {
  runScheduledOutreach, withinMorningWindow, laDayKey, recipientWindowTz, DAILY_CAP, type SchedulerDeps,
} from "./outreach-scheduler";

const MON_0930 = new Date("2026-08-31T16:30:00Z"); // Mon 09:30 America/Los_Angeles → in window
const SAT_0930 = new Date("2026-08-29T16:30:00Z"); // Sat → weekend
const MON_1300 = new Date("2026-08-31T20:00:00Z"); // Mon 13:00 LA → afternoon
// These tests exercise the scheduler MECHANISM at 09:30 LA, so they pin an explicit 08:00–10:00
// window (independent of the Settings-driven production default, which is 05:00–07:00).
const WIN = { timezone: "America/Los_Angeles", startHour: 8, endHour: 10, weekdays: [1, 2, 3, 4, 5] };

const ORIG_AUTOSEND = process.env[AUTOSEND_ENV];
const ORIG_PAUSE = process.env[PAUSE_ENV];

const strongOne = [{ id: "p", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move leaves.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] }];

async function seedStrong(name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\W/g, "");
  const lead = await insertLead({ businessName: name, normalizedName: slug, industry: "dentist", normalizedCategory: "dentist", categoryGroup: "Health", address: "1 St", city: "LA", state: "CA", postalCode: "90012", phone: "(213) 555-0100", website: `https://${slug}.example`, websiteDomain: `${slug}.example`, publicEmail: `office@${slug}.example`, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 82, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionOverride: false, assignedTo: "jordan" } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = strongOne;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}

/** Pre-load N already-used slots into the shared ledger for the given LA day (models follow-ups /
 *  manual sends already sent today — the SAME pool the scheduler draws from). */
function seedUsedSlots(n: number, now: Date) {
  const arr = ((mem() as any).emailSends ??= []) as any[];
  const iso = now.toISOString();
  for (let i = 0; i < n; i++) arr.push({ id: `pre_${i}`, idempotencyKey: `pre:${i}`, stepId: null, planId: null, leadId: `x${i}`, toAddr: "", fromAddr: "", subject: "", status: "sent", provider: "resend", providerMessageId: null, attempts: 1, queuedAt: iso, sendingAt: iso, sentAt: iso, createdAt: iso, updatedAt: iso });
}

// A non-delivering transport that records what it WOULD have sent.
function harness() {
  const dispatched: string[] = [];
  let ambiguous = false, refuse = false;
  return {
    dispatched,
    setAmbiguous: (v: boolean) => (ambiguous = v),
    setRefuse: (v: boolean) => (refuse = v),
    deps: (now: Date, over: Partial<SchedulerDeps> = {}): SchedulerDeps => ({
      now, campaignId: "launch-dry-run", window: WIN,
      send: async ({ leadId }) => { if (ambiguous) return { ok: false, ambiguous: true }; if (refuse) return { ok: false }; dispatched.push(leadId); return { ok: true, providerId: "DRYRUN-NO-DELIVERY" }; },
      ...over,
    }),
  };
}

beforeEach(() => { __resetStoreForTests(); process.env[AUTOSEND_ENV] = "1"; delete process.env[PAUSE_ENV]; });
afterEach(() => {
  if (ORIG_AUTOSEND === undefined) delete process.env[AUTOSEND_ENV]; else process.env[AUTOSEND_ENV] = ORIG_AUTOSEND;
  if (ORIG_PAUSE === undefined) delete process.env[PAUSE_ENV]; else process.env[PAUSE_ENV] = ORIG_PAUSE;
});

describe("outreach-scheduler — window/quota/pause (pure)", () => {
  it("weekday morning is in-window; weekend and afternoon are not", () => {
    expect(withinMorningWindow(MON_0930, "America/Los_Angeles", WIN)).toBe(true);
    expect(withinMorningWindow(SAT_0930, "America/Los_Angeles", WIN)).toBe(false);
    expect(withinMorningWindow(MON_1300, "America/Los_Angeles", WIN)).toBe(false);
    // And the Settings-driven default is the accepted 05:00–07:00 LA window:
    expect(withinMorningWindow(new Date("2026-08-31T13:00:00Z"))).toBe(true);  // 06:00 LA → in default window
    expect(withinMorningWindow(MON_0930)).toBe(false);                          // 09:30 LA → outside default window
  });
  it("laDayKey is the LA calendar day; recipient tz falls back to LA when unknown", () => {
    expect(laDayKey(MON_0930)).toBe("2026-08-31");
    expect(recipientWindowTz(null)).toEqual({ tz: "America/Los_Angeles", reliable: false });
    expect(recipientWindowTz("America/New_York")).toEqual({ tz: "America/New_York", reliable: true });
  });
});

describe("outreach-scheduler — non-delivering DRY RUN (Gate 7)", () => {
  it("a strong one-finding review is authorized, reserved, and dispatched (no real delivery)", async () => {
    const id = await seedStrong("Alpha Dental");
    const h = harness();
    const s = await runScheduledOutreach([id], h.deps(MON_0930));
    expect(s.sent).toBe(1);
    expect(h.dispatched).toEqual([id]);
    expect(s.outcomes[0].outcome).toBe("sent");
    expect(await countSlotsUsed(MON_0930)).toBe(1); // the shipped send draws down the shared pool
  }, 60000);

  it("policy DISABLED holds every candidate (auto-send off) and reserves NOTHING", async () => {
    process.env[AUTOSEND_ENV] = "0";
    const id = await seedStrong("Bravo Dental");
    const s = await runScheduledOutreach([id], harness().deps(MON_0930));
    expect(s.sent).toBe(0);
    expect(s.outcomes[0]).toMatchObject({ outcome: "held" });
    expect(s.outcomes[0].reason).toMatch(/disabled/i);
    expect(await countSlotsUsed(MON_0930)).toBe(0); // no slot burned on a held candidate
  });

  it("outside the weekday morning window nothing is dispatched (weekend + afternoon)", async () => {
    const id = await seedStrong("Charlie Dental");
    const wk = await runScheduledOutreach([id], harness().deps(SAT_0930));
    expect(wk.sent).toBe(0);
    expect(wk.outcomes[0].outcome).toBe("outside-window");
    const aft = await runScheduledOutreach([await seedStrong("Delta Dental")], harness().deps(MON_1300));
    expect(aft.outcomes[0].outcome).toBe("outside-window");
  });

  it("the shared 20/day cap is never exceeded — counts follow-ups + manual too", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await seedStrong(`Cap${i} Dental`));
    seedUsedSlots(19, MON_0930); // 19 already sent today (manual + follow-ups) → only ONE slot left.
    const h = harness();
    const s = await runScheduledOutreach(ids, h.deps(MON_0930));
    expect(s.sent).toBe(1);
    expect(s.quotaRemaining).toBe(0);
    expect(s.outcomes.filter((o) => o.outcome === "quota-reached").length).toBe(2);
    expect(await countSlotsUsed(MON_0930)).toBe(20); // exactly the cap, never past it
  }, 60000);

  it("pause-all stops dispatch — via the env kill-switch AND via the DB flag (no redeploy)", async () => {
    const id = await seedStrong("Echo Dental");
    process.env[PAUSE_ENV] = "1"; // secondary env control
    const envPaused = await runScheduledOutreach([id], harness().deps(MON_0930));
    expect(envPaused.outcomes[0].outcome).toBe("paused");
    delete process.env[PAUSE_ENV];

    await setOutreachPaused(true, { actor: "jordan" }); // primary DB control
    const dbPaused = await runScheduledOutreach([id], harness().deps(MON_0930));
    expect(dbPaused.sent).toBe(0);
    expect(dbPaused.outcomes[0].outcome).toBe("paused");

    await setOutreachPaused(false, { actor: "jordan" });
    const resumed = await runScheduledOutreach([id], harness().deps(MON_0930));
    expect(resumed.sent).toBe(1);
  }, 60000);

  it("a suppressed recipient and a held review are never dispatched (and reserve nothing)", async () => {
    const sup = await seedStrong("Foxtrot Dental");
    await addSuppression({ email: "office@foxtrotdental.example", domain: null, phone: null, reason: "unsubscribe", source: "test" } as any);
    const held = await seedStrong("Golf Dental");
    await skipReview(held, "waiting on a photo", { actor: "jordan" });
    const s = await runScheduledOutreach([sup, held], harness().deps(MON_0930));
    expect(s.sent).toBe(0);
    expect(s.outcomes.map((o) => o.outcome)).toEqual(["held", "held"]);
    expect(await countSlotsUsed(MON_0930)).toBe(0);
  });

  it("an ambiguous transport response RETAINS the reserved slot and does NOT count as sent (no double-send)", async () => {
    const id = await seedStrong("Hotel Dental");
    const h = harness();
    h.setAmbiguous(true);
    const s = await runScheduledOutreach([id], h.deps(MON_0930));
    expect(s.sent).toBe(0);
    expect(h.dispatched).toHaveLength(0);
    expect(s.outcomes[0].outcome).toBe("ambiguous");
    expect(await countSlotsUsed(MON_0930)).toBe(1); // slot held pending reconcile — not released, not resent
  }, 60000);

  it("idempotency: a second tick does NOT resend the same lead once it has shipped today", async () => {
    const id = await seedStrong("India Dental");
    const h = harness();
    const first = await runScheduledOutreach([id], h.deps(MON_0930));
    expect(first.sent).toBe(1);
    expect(h.dispatched).toEqual([id]);
    // second tick — the per-(lead,day) reservation already shipped → skip, never a double-send.
    const h2 = harness();
    const second = await runScheduledOutreach([id], h2.deps(MON_0930));
    expect(second.sent).toBe(0);
    expect(h2.dispatched).toHaveLength(0);
    expect(second.outcomes[0].outcome).toBe("already-sent");
    expect(await countSlotsUsed(MON_0930)).toBe(1); // still exactly one
  }, 60000);

  it("a transport refusal RELEASES the slot back to the pool (no permanent hold)", async () => {
    const id = await seedStrong("Juliet Dental");
    const h = harness();
    h.setRefuse(true);
    const s = await runScheduledOutreach([id], h.deps(MON_0930));
    expect(s.sent).toBe(0);
    expect(s.outcomes[0].outcome).toBe("held");
    expect(await countSlotsUsed(MON_0930)).toBe(0); // slot returned, not stuck reserved
  }, 60000);

  it("DAILY_CAP is 20 and is respected as the default", () => {
    expect(DAILY_CAP).toBe(20);
  });
});
