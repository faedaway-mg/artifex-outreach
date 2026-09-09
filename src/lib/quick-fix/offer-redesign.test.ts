// ─────────────────────────────────────────────────────────────────────────────
// OFFER PAGE CONVERSION REDESIGN — model fields (hero badges, qualitative impact,
// conceptual before/after, richer trust-video), claim safety (no metrics), and the
// Quick-Cash sidebar entry. Presentation is exercised here at the model level; the
// commerce/legal architecture is covered by the existing quick-fix suites.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildOfferPageModel } from "./offer-page";
import { impactForScope } from "./impact";
import { trustVideoAsEvergreen, type TrustVideoScope } from "./trust-videos";
import { containsFabricatedClaim } from "./evidence-gate";
import type { QuickFixOffer } from "./types";

const ALL_SCOPES: TrustVideoScope[] = [
  "contact-form-lead-capture", "cta-conversion", "mobile-responsive", "accessibility",
  "analytics-tracking", "cms-technical", "seo-metadata", "homepage-sprint", "fix-scan", "general",
];

const baseOffer = (over: Partial<QuickFixOffer> = {}) => ({
  offerId: "qfo_x", leadId: "lead_1", companyName: "Acme Co", offerVersion: "v1",
  findingIds: ["f1"], capabilityKeys: ["cta-repair"], priceCents: 24900, currency: "usd",
  quickFixEligible: true, notEligibleReason: null,
  scope: {
    offerName: "24-Hour Primary CTA Repair", problemBeingSolved: "The main call-to-action is unclear.",
    proposedSolution: "Clarify and repair the primary action.",
    includedItems: ["Clarify the primary action", "Repair broken clicks", "Verify the path"],
    excludedItems: ["Full redesign"], customerInputsRequired: ["website-admin"],
    deliveryWindow: "Delivered within 24 hours of receiving the required access.", revisionPolicy: "one round",
  },
  maintenance: null,
  ...over,
}) as unknown as QuickFixOffer;

function model(offer: QuickFixOffer, approved = true) {
  return buildOfferPageModel({
    offer, evergreen: trustVideoAsEvergreen(offer), approved,
    stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://x/book",
  });
}

describe("impact templates are qualitative — no fabricated metrics anywhere", () => {
  it("every scope yields 2-3 impact points + before/after with no numbers/percentages", () => {
    for (const scope of ALL_SCOPES) {
      const im = impactForScope(scope);
      expect(im.impactPoints.length).toBeGreaterThanOrEqual(2);
      expect(im.impactPoints.length).toBeLessThanOrEqual(3);
      const blob = [...im.impactPoints, im.before, im.after].join(" ");
      expect(/\d/.test(blob), `${scope} has a digit`).toBe(false);
      expect(blob.includes("%"), `${scope} has a percentage`).toBe(false);
      expect(containsFabricatedClaim(blob), `${scope} fabrication`).toBe(false);
    }
  });
});

describe("offer page model — premium hero + skimmable fields", () => {
  it("an eligible offer exposes hero badges, impact, before/after, and a v2 trust video", () => {
    const m = model(baseOffer());
    expect(m.trustBadges).toContain("Fixed scope");
    expect(m.trustBadges).toContain("No surprise charges");
    expect(m.trustBadges.some((b) => /24 hours after access/i.test(b))).toBe(true);
    expect(m.impactPoints.length).toBeGreaterThanOrEqual(2);
    expect(m.beforeAfter.before.length).toBeGreaterThan(0);
    expect(m.beforeAfter.after.length).toBeGreaterThan(0);
    expect(m.scope).toBe("cta-conversion");
    expect(m.trustVideo.assetUrl).toBe("/trust-videos/cta-conversion-v2.mp4");
    expect(m.trustVideo.posterUrl).toBe("/trust-videos/cta-conversion-v2-poster.jpg");
    expect(m.trustVideo.captionsUrl).toBe("/trust-videos/cta-conversion-v2.vtt");
    expect(m.trustVideo.title).toContain("CTA");
  });
  it("hero badges carry no fabricated metric", () => {
    const m = model(baseOffer());
    for (const b of m.trustBadges) expect(containsFabricatedClaim(b), b).toBe(false);
  });
  it("a conversation-only (non-quick-fix) offer shows no sales badges", () => {
    const m = model(baseOffer({ quickFixEligible: false, notEligibleReason: "needs discovery" }));
    expect(m.conversationOnly).toBe(true);
    expect(m.trustBadges).toEqual([]);
  });
  it("price stays server-derived from the offer, never the browser", () => {
    const m = model(baseOffer({ priceCents: 49500 }));
    expect(m.priceLabel).toBe("$495 flat");
  });
});

describe("Quick-Cash is exposed in the primary sidebar", () => {
  it("the shell nav references the existing Quick-Cash route (not a duplicate page)", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/Shell.tsx"), "utf8");
    expect(src).toContain('href: "/revenue/quick-cash"');
    expect(src).toContain('label: "Quick-Cash"');
  });
});
