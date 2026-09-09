// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT OPERATOR-SIDE — view + batch logic + regression-gate smoke test.
//
// Proves:
//   • breakbotVerdictView runs the real engine over a STORED offer and returns a
//     structured verdict; null when no offer is stored.
//   • breakbotBatchView runs over the high-confidence quick-fix offers, aggregates
//     the common blockers, and keeps SALES qualification INDEPENDENT of ASSET
//     readiness — an ungenerated/stale ASSET never downgrades a sales-qualified lead.
//   • the release-regression gate (pure) reports every golden READY + every failure
//     BLOCKED on its expected surface, with allPass true and 0 regressions.
//
// All external reads are mocked → NO database, NO provider, NO sends, NO charges.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateOffer } from "./offer-engine";
import type { OfferFinding, QuickFixOffer } from "./types";
import type { StoredOffer } from "./store";

const F = (over: Partial<OfferFinding> = {}): OfferFinding => ({
  id: "cta", category: "Customer Acquisition", observation: "the primary CTA button is hard to find on mobile",
  whyItMatters: "visitors can't easily take the next step", confidenceLabel: "Observed", confidenceScore: 0.95,
  impactLevel: "High", basis: ["link: https://x"], ...over,
});
const baseOffer = (over: { leadId?: string; companyName?: string } = {}): QuickFixOffer =>
  generateOffer({ leadId: over.leadId ?? "lead_1", companyName: over.companyName ?? "Acme Roofing", findings: [F()], generatedAt: "2026-09-01T00:00:00Z" });

const STORED_WEBSITE = "https://acme-roofing.example";

let storedOffers: Record<string, StoredOffer> = {};
let mockLeads: any[] = [];
let salesReady = true; // drives the qualification-adapter mock

vi.mock("../repo", () => ({
  getLead: vi.fn(async () => ({ website: STORED_WEBSITE })),
  getBusinessIntelligence: vi.fn(async () => ({ profile: { businessProfile: { opportunities: [
    { id: "cta", category: "Customer Acquisition", observation: "the primary CTA button is hard to find on mobile", whyItMatters: "visitors can't easily take the next step", confidence: { label: "Observed", score: 0.95 }, basis: ["link: https://x"], estimatedImpact: { level: "High" } },
  ] } } })),
  listLeads: vi.fn(async () => mockLeads),
  listAudit: vi.fn(async () => []),
  buildSuppressionChecker: vi.fn(async () => () => false),
}));

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    getOffer: vi.fn(async (id: string) => storedOffers[id] ?? null),
    listOffers: vi.fn(async () => Object.values(storedOffers)),
    getJob: vi.fn(async () => null),
    getState: vi.fn(async () => ({ offers: storedOffers, customers: {}, jobs: {} } as any)),
    listJobs: vi.fn(async () => []),
    getTermsAcceptance: vi.fn(async () => null),
  };
});

// Qualification is orthogonal to the engine; the mock lets us assert the batch never
// downgrades a SALES-qualified lead because an ASSET is blocked.
vi.mock("./qualification-adapter", () => ({
  qualifyLeadRecord: vi.fn(() => ({
    leadId: "lead_1",
    qualification: { readyToSell: salesReady, readyToSend: false, disqualifiers: [], reasons: [], offerReady: false } as any,
    contactability: {} as any, commercialFit: {} as any, overlap: {} as any, jurisdiction: {} as any,
    sendablePriceCents: salesReady ? 30000 : 0,
  })),
}));

import { breakbotVerdictView, breakbotBatchView } from "./operator-views";
import { runRegression } from "../breakbot/regression";

function makeStored(over: Partial<StoredOffer> = {}): StoredOffer {
  const o = baseOffer();
  return {
    ...o,
    approvalStatus: "draft", createdAt: "", updatedAt: "", approvedBy: null,
    recipientEmail: "owner@acme.example", shareToken: "tok_abc", shareRevoked: false,
    ...over,
  } as StoredOffer;
}

beforeEach(() => {
  storedOffers = { qfo_x: makeStored({ offerId: "qfo_x" } as any) };
  mockLeads = [{ id: "lead_1", website: STORED_WEBSITE, businessName: "Acme Roofing" }];
  salesReady = true;
});

describe("breakbotVerdictView", () => {
  it("returns a structured verdict for a stored offer", async () => {
    const v = await breakbotVerdictView("qfo_x");
    expect(v).not.toBeNull();
    expect(["READY", "BLOCKED"]).toContain(v!.overall);
    expect(v!.counts.total).toBe(v!.counts.passed + v!.issues.length);
    // A blocker (and only a blocker) is what forces BLOCKED.
    expect(v!.overall === "READY").toBe(v!.counts.blockers === 0);
  });

  it("returns null when no offer is stored (read-only, no fabrication)", async () => {
    const v = await breakbotVerdictView("does_not_exist");
    expect(v).toBeNull();
  });
});

describe("breakbotBatchView — asset QA + sales/asset distinction", () => {
  it("scans the high-confidence offers and returns per-offer rows + aggregation", async () => {
    storedOffers = {
      a: makeStored({ offerId: "a", companyName: "A Co", confidence: 0.9 } as any),
      b: makeStored({ offerId: "b", companyName: "B Co", confidence: 0.8 } as any),
    };
    const view = await breakbotBatchView(10);
    expect(view.scanned).toBe(2);
    expect(view.rows).toHaveLength(2);
    expect(view.assetReadyCount + view.assetBlockedCount).toBe(2);
    // Confidence-descending order.
    expect(view.rows[0].confidence).toBeGreaterThanOrEqual(view.rows[1].confidence);
    // commonBlockers is descending by count.
    for (let i = 1; i < view.commonBlockers.length; i++) {
      expect(view.commonBlockers[i - 1].count).toBeGreaterThanOrEqual(view.commonBlockers[i].count);
    }
  });

  it("keeps SALES qualification independent of ASSET readiness (never downgrades a sales-qualified lead)", async () => {
    // Sales-qualified lead. Regardless of whether Breakbot blocks the ASSET, the row must
    // report salesQualified=true and the batch must count the sell-ready-but-asset-blocked
    // intersection as a BUILD task, never a disqualification.
    salesReady = true;
    const view = await breakbotBatchView(10);
    for (const r of view.rows) expect(r.salesQualified).toBe(true);
    expect(view.salesQualifiedCount).toBe(view.rows.length);
    // If any asset is blocked, it shows up as SALES-QUALIFIED-but-ASSET-BLOCKED, not a drop.
    const blocked = view.rows.filter((r) => !r.assetReady).length;
    expect(view.salesQualifiedButAssetBlocked).toBe(blocked);
  });

  it("respects the top-N limit", async () => {
    storedOffers = {
      a: makeStored({ offerId: "a", confidence: 0.9 } as any),
      b: makeStored({ offerId: "b", confidence: 0.8 } as any),
      c: makeStored({ offerId: "c", confidence: 0.7 } as any),
    };
    const view = await breakbotBatchView(2);
    expect(view.scanned).toBe(2);
  });
});

describe("release-regression gate (pure) — smoke", () => {
  it("all golden READY and every failure blocked on its expected surface", () => {
    const r = runRegression();
    // 5 golden presentation-ready fixtures; the failure set grew to 22 when the
    // mandatory-personalized-video policy added the missing/stale-video regressions.
    expect(r.goldenTotal).toBe(5);
    expect(r.failureTotal).toBeGreaterThanOrEqual(22);
    expect(r.goldenPassed).toBe(r.goldenTotal);
    expect(r.failurePassed).toBe(r.failureTotal);
    expect(r.allPass).toBe(true);
    expect(r.regressions).toEqual([]);
  });

  it("each failure result carries its expected blocker surface among the observed blockers", () => {
    const r = runRegression();
    for (const f of r.failure) {
      expect(f.overall).toBe("BLOCKED");
      expect(f.blockerSurfaces).toContain(f.expectBlockerSurface);
    }
  });
});
