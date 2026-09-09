// ─────────────────────────────────────────────────────────────────────────────
// GROWTH + SPRINT + CAPACITY + JURISDICTION-GATE — a shortage expands discovery
// (never lowers the bar), market bias affects priority not qualification, outbound
// must be specific, capacity modes never break customer traffic, the sprint
// scoreboard is honest, and the send path is jurisdiction fail-closed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach } from "vitest";
import { planDiscovery, discoveryShouldStop, DEFAULT_QUALIFIED_INVENTORY_TARGET } from "./discovery-objective";
import { marketTierOf, receptivityPoints, isEstablished } from "../geo-market";
import { MIN_QUALIFYING_CONFIDENCE, qualifyLead } from "./qualification";
import { assessContactability } from "./contactability";
import { assessCommercialFit } from "./commercial-fit";
import { assessCompetitiveOverlap } from "./competitive-overlap";
import { sendEligibility } from "./jurisdiction";
import { assessOutboundQuality } from "./outbound-quality";
import { capacityPosture, currentCapacityMode, coldOutreachAllowedByCapacity, CAPACITY_MODE_ENV } from "../outreach/capacity-modes";
import { buildSprintScoreboard, referenceReadiness, capabilityEvidenceExport, recurringCandidate } from "./sprint";
import { assessDeliveryReadiness, type DeliveryContext } from "../acquisition/delivery-ready";

describe("discovery objective — expand breadth, never lower the bar (PRINCIPLE 1)", () => {
  it("30/31. a shortage expands discovery; the qualification threshold is a fixed constant", () => {
    const plan = planDiscovery(8, 20);
    expect(plan.expand).toBe(true);
    expect(plan.discoverTarget).toBeGreaterThan(0);
    expect(plan.thresholdsUnchanged).toBe(true);
    // The bar itself is a fixed constant — sizing discovery cannot move it.
    expect(MIN_QUALIFYING_CONFIDENCE).toBe(0.6);
  });
  it("32. sizing is deterministic (same input → same plan)", () => {
    expect(planDiscovery(10, 40)).toEqual(planDiscovery(10, 40));
    expect(DEFAULT_QUALIFIED_INVENTORY_TARGET).toBe(40);
  });
  it("33. the loop stops at target, at budget, or when the universe is dry", () => {
    expect(discoveryShouldStop(40, 40, 500, 5).stop).toBe(true);
    expect(discoveryShouldStop(10, 40, 0, 5).stop).toBe(true);
    expect(discoveryShouldStop(10, 40, 500, 0).stop).toBe(true);
    expect(discoveryShouldStop(10, 40, 500, 3).stop).toBe(false);
  });
  it("34. discovery is bounded — never unbounded (capped by remaining budget)", () => {
    const plan = planDiscovery(0, 1000, undefined, 12);
    expect(plan.discoverTarget).toBeLessThanOrEqual(12);
  });
  it("47. filling the inventory target does NOT authorize sending", () => {
    expect(planDiscovery(0, 40).impliesSendAuthorization).toBe(false);
  });
});

describe("market bias — secondary/tertiary priority, not a qualification gate (PART K)", () => {
  it("35. bias is a small capped tie-breaker for established regional businesses only", () => {
    const regional = { city: "Fort Wayne", state: "IN", reviewCount: 120, locationsCount: 1 };
    const primary = { city: "Los Angeles", state: "CA", reviewCount: 120, locationsCount: 1 };
    expect(marketTierOf(regional)).toBe("regional");
    expect(marketTierOf(primary)).toBe("primary");
    expect(receptivityPoints(regional)).toBeGreaterThan(0);
    expect(receptivityPoints(regional)).toBeLessThanOrEqual(4); // capped
    expect(receptivityPoints(primary)).toBe(0);
    expect(isEstablished({ reviewCount: 5, locationsCount: 1 })).toBe(false);
  });
  it("36. a major-metro excellent lead still qualifies (tier is not a funnel input)", () => {
    const q = qualifyLead({
      hasWebsite: true,
      contactability: assessContactability({ email: "hello@lametro.com", website: "https://lametro.com" }),
      businessActive: true,
      commercialFit: assessCommercialFit({ hasActiveWebsite: true, hasCommercialIntent: true, reviewCount: 200, establishedDomain: true, defectAffectsCommercialAction: true, priceCents: 24900, strongSkuSupport: true }),
      overlap: assessCompetitiveOverlap({ industry: "Dental practice" }),
      readyToSellFix: true, matchedSku: "cta-repair", confidence: 0.9, hasObservedDefect: true, clearsMarginGate: true,
      jurisdiction: sendEligibility("US"),
    });
    expect(q.readyToSell).toBe(true); // LA metro not penalized in the qualification bar
  });
});

describe("outbound quality (PART N) — specific, never generic", () => {
  it("a specific, complete draft passes", () => {
    const q = assessOutboundQuality({
      whyThisBusiness: "your online booking button 404s on mobile",
      whatWeFound: "the primary CTA links to a dead URL on phones",
      whatWeFix: "repair the booking CTA target + verify on desktop/mobile",
      priceCents: 24900, turnaround: "24 hours", nextAction: "review the fix and approve",
      body: "We reviewed your site and found the booking button is broken on mobile. We can fix it for $249 in 24 hours.",
    });
    expect(q.passes).toBe(true);
  });
  it("a generic capability-first pitch is rejected", () => {
    const q = assessOutboundQuality({ whyThisBusiness: "you exist", body: "We provide web development, apps, AI and software. Would you be open to a conversation?" });
    expect(q.passes).toBe(false);
    expect(q.problems.length).toBeGreaterThan(0);
    expect(q.missing.length).toBeGreaterThan(0);
  });
  it("fabricated performance / fake urgency is rejected", () => {
    const q = assessOutboundQuality({ whyThisBusiness: "x", whatWeFound: "y", whatWeFix: "z", priceCents: 24900, turnaround: "24h", nextAction: "buy", body: "Act now — increase your revenue by 40%, guaranteed!" });
    expect(q.passes).toBe(false);
  });
});

describe("capacity modes (PART S) — never break customer traffic, never touch caps", () => {
  afterEach(() => { delete process.env[CAPACITY_MODE_ENV]; });
  it("45. PAUSED stops new cold outbound but customer/transactional stays operational", () => {
    const p = capacityPosture("PAUSED");
    expect(p.coldOutreachAllowed).toBe(false);
    expect(p.customerTrafficAllowed).toBe(true);
    expect(coldOutreachAllowedByCapacity({ [CAPACITY_MODE_ENV]: "PAUSED" } as any).allowed).toBe(false);
  });
  it("46. GROWTH permits outbound and NEVER alters sender caps", () => {
    const p = capacityPosture("GROWTH");
    expect(p.coldOutreachAllowed).toBe(true);
    expect(p.altersSenderCaps).toBe(false);
    expect(currentCapacityMode({} as any)).toBe("GROWTH"); // default
  });
  it("DELEGATED is never auto-activated — only an explicit env selects it", () => {
    expect(currentCapacityMode({} as any)).toBe("GROWTH");
    expect(currentCapacityMode({ [CAPACITY_MODE_ENV]: "DELEGATED" } as any)).toBe("DELEGATED");
  });
});

describe("sprint scoreboard (PARTS Q/R) — honest counts, permission-gated references", () => {
  const jobs = [
    { offerId: "a", state: "COMPLETE", priceCents: 24900, skuFamily: "CONVERSION", hasCompletionEvidence: true },
    { offerId: "b", state: "COMPLETE", priceCents: 49500, skuFamily: "WEBSITE_FUNCTION", hasCompletionEvidence: true },
    { offerId: "c", state: "IN_PROGRESS", priceCents: 24900, skuFamily: "CONVERSION" },
  ];
  const customers = [
    { leadId: "l1", purchases: 2, lifetimeRevenueCents: 74400, hasCompletedJob: true, referenceApproved: false },
    { leadId: "l2", purchases: 1, lifetimeRevenueCents: 24900, hasCompletedJob: true, referenceApproved: true, maintenancePlanKey: "care-basic" },
  ];
  it("41/42. completed-job counter reflects actual COMPLETE state + 20/50 status", () => {
    const s = buildSprintScoreboard(jobs, customers);
    expect(s.completedJobs).toBe(2);
    expect(s.reachedCheckpoint).toBe(false);
    expect(s.graduated).toBe(false);
    expect(s.checkpoint).toBe(20);
    expect(s.graduation).toBe(50);
    expect(s.avgTicketCents).toBe(37200);
    expect(s.capabilityProofs).toBe(2);
    expect(s.playbooksProven).toBe(2);
    expect(s.recurringCustomers).toBe(1);
  });
  it("43. reference-eligible is NOT the same as permission granted", () => {
    const noPerm = referenceReadiness(customers[0]);
    expect(noPerm.eligible).toBe(true);
    expect(noPerm.permissionGranted).toBe(false);
    expect(noPerm.mayNamePublicly).toBe(false);
    const withPerm = referenceReadiness(customers[1]);
    expect(withPerm.permissionGranted).toBe(true);
    expect(withPerm.mayNamePublicly).toBe(true);
  });
  it("44. capability evidence is COMMERCIAL, never government past performance", () => {
    const ev = capabilityEvidenceExport(jobs);
    for (const e of ev) {
      expect(e.evidenceType).toBe("COMMERCIAL");
      expect(e.isGovernmentPastPerformance).toBe(false);
    }
    expect(ev.find((e) => e.capability === "CONVERSION")?.klass).toBe("PROVEN");
  });
  it("recurring candidate is tracked, never forced", () => {
    expect(recurringCandidate(customers[0]).isCandidate).toBe(true); // repeat
    expect(recurringCandidate({ leadId: "x", purchases: 0, lifetimeRevenueCents: 0 }).isCandidate).toBe(false);
  });
});

describe("send path is jurisdiction fail-closed (PART M)", () => {
  const ready = (over: Partial<DeliveryContext> = {}): DeliveryContext => ({
    leadId: "l", businessName: "Acme", website: "https://acme.com", websiteDomain: "acme.com",
    serviceFit: true, recipientEmail: "hi@acme.com", recipientEmailValid: true, hasObservedFinding: true,
    reviewApproved: true, reviewSendable: true, attachmentSha: "sha", footerReady: true,
    suppressed: false, unsubscribed: false, bounced: false, duplicate: false, priorContact: false,
    recipientTimezone: "America/New_York", score: 1, city: "Fort Wayne", state: "IN", ...over,
  });
  it("no country set → back-compatible (no jurisdiction reason)", () => {
    expect(assessDeliveryReadiness(ready()).ready).toBe(true);
  });
  it("US is cleared; GB and an unknown country fail closed", () => {
    expect(assessDeliveryReadiness(ready({ country: "US" })).ready).toBe(true);
    const gb = assessDeliveryReadiness(ready({ country: "GB" }));
    expect(gb.ready).toBe(false);
    expect(gb.reasons).toContain("jurisdiction_blocked");
    expect(assessDeliveryReadiness(ready({ country: "ZZ" })).reasons).toContain("jurisdiction_blocked");
  });
});
