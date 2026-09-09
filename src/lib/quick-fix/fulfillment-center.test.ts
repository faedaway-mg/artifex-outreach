// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT CENTER — packet assembly, platform-aware least-privilege Access Center
// (never a password), platform runbook + deploy method, scope + safety gates.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { generateOffer } from "./offer-engine";
import {
  normalizePlatform, buildAccessCenter, buildRunbook, scopeGate, safetyGate,
  buildFulfillmentPacket, accessCloseoutGuidance,
} from "./fulfillment-center";
import type { OfferFinding } from "./types";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile" });
const offer = () => ({ ...generateOffer({ leadId: "lead_1", companyName: "a2z Health", findings: [CTA], generatedAt: null }), offerId: "offer_1" });
const job = (over = {}) => ({ offerId: "offer_1", leadId: "lead_1", state: "READY_FOR_FULFILLMENT", purchasedAt: "2026-09-09T00:00:00Z", requirementsReceivedAt: "2026-09-09T01:00:00Z", targetDeliveryAt: null, ...over } as any);

describe("platform normalization", () => {
  it("maps detected names to canonical platforms; unknown is honest", () => {
    expect(normalizePlatform("WordPress 6.4 / WooCommerce")).toBe("wordpress");
    expect(normalizePlatform("Shopify")).toBe("shopify");
    expect(normalizePlatform("Webflow")).toBe("webflow");
    expect(normalizePlatform(null)).toBe("unknown");
    expect(normalizePlatform("some bespoke stack")).toBe("unknown");
  });
});

describe("Access Center — least privilege, platform-specific, never a password", () => {
  it("gives platform-specific native-invite steps and never asks for a password", () => {
    const ac = buildAccessCenter(offer(), "wordpress");
    expect(ac.platformLabel).toBe("WordPress");
    expect(ac.instructions.length).toBeGreaterThan(0);
    const allSteps = ac.instructions.flatMap((i) => i.steps).join(" ").toLowerCase();
    expect(allSteps).toContain("users"); // WP Users → invite
    expect(allSteps).not.toContain("password");
    for (const i of ac.instructions) expect(i.method).toBe("native-invite");
    expect(ac.neverAskFor.join(" ").toLowerCase()).toContain("password");
    expect(ac.assist.bookCall).toBe(true);
  });
  it("does not request broad access the fix doesn't need (no DNS/registrar for a CTA repair)", () => {
    const ac = buildAccessCenter(offer(), "wordpress");
    const keys = ac.instructions.map((i) => i.key).join(" ");
    expect(keys).not.toContain("dns");
    expect(keys).not.toContain("registrar");
  });
  it("revocation guidance respects the revision window", () => {
    expect(accessCloseoutGuidance(offer())).toMatch(/revoke/i);
  });
});

describe("Runbook — platform deploy method; unknown platform → technical review", () => {
  it("supported SKU+platform yields a checkable runbook with a platform-specific deploy step", () => {
    const rb = buildRunbook(offer(), "wordpress");
    expect(rb.supported).toBe(true);
    expect(rb.steps.some((s) => s.kind === "deploy")).toBe(true);
    expect(rb.deployMethod.toLowerCase()).toContain("wordpress");
    expect(rb.steps.some((s) => s.kind === "retest")).toBe(true);   // production retest required
    expect(rb.steps.some((s) => s.kind === "evidence")).toBe(true);
    expect(rb.qaChecklist.length).toBeGreaterThan(0);
  });
  it("unknown platform is NEEDS TECHNICAL REVIEW, not hallucinated instructions", () => {
    const rb = buildRunbook(offer(), "unknown");
    expect(rb.supported).toBe(false);
    expect(rb.reviewReason).toBeTruthy();
    expect(rb.deployMethod).toMatch(/technical review/i);
  });
});

describe("Pre-change gates", () => {
  it("scopeGate confirms, or raises a SCOPE_EXCEPTION with a recommended route", () => {
    expect(scopeGate(offer(), { confirmed: true }).gate).toBe("SCOPE_CONFIRMED");
    const exc = scopeGate(offer(), { observedIssue: "the booking plugin is failing, not the CTA" });
    expect(exc.gate).toBe("SCOPE_EXCEPTION");
    expect(exc.recommendedRoute).toBe("DIFFERENT_SKU");
    expect(exc.reason).toBeTruthy();
  });
  it("safetyGate blocks START until scope+access+pre-change+rollback are satisfied", () => {
    const confirmed = scopeGate(offer(), { confirmed: true });
    const blocked = safetyGate({ offer: offer(), job: job(), scope: confirmed, preChangeCaptured: false, platform: "wordpress" });
    expect(blocked.canStart).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(0);
    const ready = safetyGate({ offer: offer(), job: job(), scope: confirmed, preChangeCaptured: true, platform: "wordpress" });
    expect(ready.canStart).toBe(true);
  });
  it("safetyGate cannot start on an unresolved scope exception", () => {
    const exc = scopeGate(offer(), { observedIssue: "different problem" });
    const g = safetyGate({ offer: offer(), job: job(), scope: exc, preChangeCaptured: true, platform: "wordpress" });
    expect(g.canStart).toBe(false);
  });
});

describe("Fulfillment Packet — one canonical post-purchase object", () => {
  it("assembles customer/purchase + sale context + technical + execution, with DO NOT TOUCH", () => {
    const p = buildFulfillmentPacket({ offer: offer(), job: job(), customer: { leadId: "lead_1", email: "c@x.com" } as any, detectedPlatform: "WordPress", termsVersion: "quickfix-terms-v2-2026-09" });
    expect(p.company).toBe("a2z Health");
    expect(p.serviceName).toBe(offer().scope.offerName);
    expect(p.platform).toBe("wordpress");
    expect(p.doNotTouch).toContain("DNS / domain settings");
    expect(p.doNotTouch).toEqual(expect.arrayContaining(offer().scope.excludedItems));
    expect(p.accessCenter.instructions.length).toBeGreaterThan(0);
    expect(p.runbook.supported).toBe(true);
    expect(p.completionEvidenceRequired.length).toBeGreaterThan(0);
    expect(p.termsVersion).toBe("quickfix-terms-v2-2026-09");
    expect(p.isCustomer).toBe(true);
  });
});
