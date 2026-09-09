// ─────────────────────────────────────────────────────────────────────────────
// QUICK-CASH CONSOLIDATION — every lead routes to exactly one canonical route,
// ranking is deterministic + gross-profit-per-hour (never price), and the nav is
// organized around the money loop with Quick-Cash as the default home.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateOffer } from "./offer-engine";
import { routeLead } from "./fix-scan";
import { rankQuickCash, scoreQuickCash } from "./quick-cash";
import type { OfferFinding } from "./types";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const gen = (findings: OfferFinding[], over: Partial<Parameters<typeof generateOffer>[0]> = {}) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings, generatedAt: null, ...over });

const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile" });
const CAPTURE = F({ id: "cap", observation: "no online booking so visitors can't schedule; the whole lead capture path is weak" });
const HOMEPAGE = F({ id: "home", observation: "the homepage hero doesn't state the value proposition above the fold", category: "Brand Experience" });
const VAGUE = F({ id: "v", observation: "their website could be better", category: "Brand Experience", confidenceLabel: "Inferred", basis: [] });

const ROUTES = ["DIRECT_FIX", "FIX_SCAN", "CONVERSATION_REQUIRED", "NO_FIX_FOUND"];

describe("classifier — exactly one canonical route per lead", () => {
  it("every offer resolves to exactly one of the four routes", () => {
    for (const findings of [[CTA], [VAGUE], [CAPTURE, HOMEPAGE], []]) {
      const r = routeLead(gen(findings as OfferFinding[]));
      expect(ROUTES).toContain(r.route);
      // exactly one — routeLead returns a single route, never a set.
      expect(typeof r.route).toBe("string");
    }
  });
  it("a concrete, SKU-matched defect → DIRECT_FIX; vague → NO_FIX_FOUND; no website → CONVERSATION", () => {
    expect(routeLead(gen([CTA])).route).toBe("DIRECT_FIX");
    expect(routeLead(gen([VAGUE])).route).toBe("NO_FIX_FOUND");
    expect(routeLead(gen([CTA], { hasWebsite: false })).route).toBe("CONVERSATION_REQUIRED");
  });
});

describe("ranking — deterministic + gross-profit-per-hour, not price", () => {
  it("a ready-to-sell $249 fix outranks a vague/ineligible bigger opportunity", () => {
    const ready = gen([CTA]);         // eligible, ENTRY $249, ready to sell
    const vague = gen([VAGUE]);       // ineligible → score 0
    expect(ready.quickFixEligible).toBe(true);
    expect(scoreQuickCash(ready)).toBeGreaterThan(0);
    expect(scoreQuickCash(vague)).toBe(0);
    const rows = rankQuickCash([vague, ready]);
    expect(rows[0].leadId).toBe(ready.leadId);
    expect(rows[0].readyToSell).toBe(true);
  });
  it("ranking is a pure function of the offers (same input → same order)", () => {
    const offers = [gen([VAGUE]), gen([CTA]), gen([CAPTURE, HOMEPAGE])];
    const a = rankQuickCash(offers).map((r) => r.leadId + r.score);
    const b = rankQuickCash(offers).map((r) => r.leadId + r.score);
    expect(a).toEqual(b);
  });
});

describe("navigation — Quick-Cash is the default home, money-loop order", () => {
  it("the shell nav opens Quick-Cash at '/' and exposes Fulfillment + Customers", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/Shell.tsx"), "utf8");
    expect(src).toContain('{ href: "/", label: "Quick-Cash"');
    expect(src).toContain('label: "Fulfillment"');
    expect(src).toContain('label: "Customers"');
    // Today is now a secondary surface, not the home.
    expect(src).toContain('"/today": "Today"');
  });
  it("the legacy Today content moved to /today", () => {
    // The relocated route file exists and the old home is now the Quick-Cash workspace.
    const home = readFileSync(path.join(process.cwd(), "src/app/(app)/page.tsx"), "utf8");
    expect(home).toContain("quickCashHomeView");
    const today = readFileSync(path.join(process.cwd(), "src/app/(app)/today/page.tsx"), "utf8");
    expect(today).toContain("buildCompanySnapshot");
  });
});
