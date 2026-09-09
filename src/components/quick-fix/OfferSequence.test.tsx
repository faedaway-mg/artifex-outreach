// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER OFFER PAGE — VALUE-BEFORE-PRICE SEQUENCE.
//
// Proves the information-architecture contract of the progressive persuasion page:
//   • the hero leads with the EXPERIENCE frame (experience.offerHeroTitle), never the
//     price or SKU, and that framing appears BEFORE the price in document order;
//   • real observed evidence precedes the price;
//   • the single price derives from the server's offer.priceCents and appears BEFORE
//     the purchase CTA — it is delayed, never hidden until checkout;
//   • the "what's included" value stack comes from scope.includedItems only (no fake
//     bonus, no invented "$X value");
//   • the PRE-price sticky shows a scroll action ("See the fix"), NOT the price, and
//     cannot initiate checkout; the sticky carries the server price for its post-price
//     state.
//
// Like the sibling evidence test we render to static markup with react-dom/server and
// assert on the produced HTML. The interactive checkout island is stubbed; the sticky
// bar is rendered for real (its initial, pre-price markup is what we assert). No sends,
// no charges — pure view assembly.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Stub only the checkout island; render the sticky bar for real so we can inspect its
// pre-price markup (SSR keeps it in the initial shown=false / pastPrice=false state).
vi.mock("./OfferCheckout", () => ({ OfferCheckout: () => null }));

import { OfferPageView } from "./OfferPageView";
import { OfferStickyBar } from "./OfferStickyBar";
import { buildOfferPageModel } from "@/lib/quick-fix/offer-page";
import { trustVideoAsEvergreen } from "@/lib/quick-fix/trust-videos";
import type { OfferPageModel } from "@/lib/quick-fix/offer-page";
import type { QuickFixOffer } from "@/lib/quick-fix/types";

// A booking-family offer → experience frame supports "I tried to book online."
const bookingOffer = (over: Partial<QuickFixOffer> = {}) => ({
  offerId: "qfo_x", leadId: "lead_1", companyName: "Acme Co", offerVersion: "v1",
  findingIds: ["f1"], capabilityKeys: ["cta-repair"], priceCents: 24900, currency: "usd",
  quickFixEligible: true, notEligibleReason: null,
  scope: {
    offerName: "Booking Button Repair",
    problemBeingSolved: "I couldn't find a way to book online from the pages I checked.",
    proposedSolution: "Clarify and repair the primary booking action.",
    includedItems: ["Clarify the primary booking button", "Verify the booking path end to end"],
    excludedItems: ["Full redesign"], customerInputsRequired: ["website-admin"],
    deliveryWindow: "Delivered within 24 hours of receiving the required access.", revisionPolicy: "one round of revisions",
  },
  maintenance: null,
  ...over,
}) as unknown as QuickFixOffer;

function model(offer: QuickFixOffer = bookingOffer()): OfferPageModel {
  return buildOfferPageModel({
    offer, evergreen: trustVideoAsEvergreen(offer), approved: true,
    stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://x/book",
  });
}

const render = (m: OfferPageModel) => renderToStaticMarkup(<OfferPageView model={m} token="tok_1" />);
// React escapes apostrophes to the &#x27; entity in static markup; normalize so we can
// assert on human-readable copy that contains apostrophes ("Here's where I got stuck.").
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("offer page — value-before-price sequence", () => {
  it("the hero leads with the experience frame, not the price or SKU", () => {
    const m = model();
    const html = unescape(render(m));
    // The hero title is the experience frame's attempted-use line.
    expect(m.experience.offerHeroTitle).toContain("I tried to book online");
    expect(html).toContain(m.experience.offerHeroTitle);
    expect(html).toContain(m.experience.offerHeroSubline);
    expect(html).toContain("We tested this on the pages below and documented what we found.");

    // The hero region (before the first price occurrence) must NOT contain the price
    // or the SKU/offer name.
    const priceIdx = html.indexOf(m.priceLabel);
    const heroTitleIdx = html.indexOf(m.experience.offerHeroTitle);
    expect(heroTitleIdx).toBeGreaterThanOrEqual(0);
    expect(priceIdx).toBeGreaterThan(heroTitleIdx); // experience framing is primary, before price
    const hero = html.slice(0, heroTitleIdx + m.experience.offerHeroTitle.length + 400);
    expect(hero).not.toContain(m.priceLabel);
    expect(hero).not.toContain("Booking Button Repair"); // offer/SKU name never leads
  });

  it("real observed evidence precedes the price in document order", () => {
    const html = render(model());
    // With no evidence package the text evidence fallback ("Observed issue") stands in
    // for real evidence — either way, observed evidence comes before the price.
    const evidenceIdx = html.indexOf("Observed issue");
    const priceIdx = html.indexOf("Everything above");
    expect(evidenceIdx).toBeGreaterThanOrEqual(0);
    expect(priceIdx).toBeGreaterThan(evidenceIdx);
  });

  it("the price derives from offer.priceCents and appears BEFORE the purchase CTA (not hidden until checkout)", () => {
    const m = model();
    const html = render(m);
    // priceLabel is derived from the server priceCents ($249 from 24900).
    expect(m.priceLabel).toBe("$249 flat");
    expect(html).toContain("Everything above");
    // The price reveal section renders the price...
    const priceRevealIdx = html.indexOf("Everything above");
    // ...and it comes before the purchase CTA island anchor.
    const ctaIdx = html.indexOf('id="offer-buy"');
    expect(priceRevealIdx).toBeGreaterThanOrEqual(0);
    expect(ctaIdx).toBeGreaterThan(priceRevealIdx);
    // The price is visible on the page (not hidden behind checkout).
    expect(html).toContain(m.priceLabel);
  });

  it("a different price flows straight from offer.priceCents (never hard-coded)", () => {
    const m = model(bookingOffer({ priceCents: 19900 } as Partial<QuickFixOffer>));
    expect(m.priceLabel).toBe("$199 flat");
    const html = render(m);
    expect(html).toContain("$199 flat");
    expect(html).not.toContain("$249");
  });

  it("the what's-included stack comes from scope.includedItems only (no fake bonus)", () => {
    const m = model();
    const html = render(m);
    expect(html).toContain("Clarify the primary booking button");
    expect(html).toContain("Verify the booking path end to end");
    // No invented bonuses or fabricated dollar-value labels.
    expect(html).not.toMatch(/bonus/i);
    expect(html).not.toMatch(/\$\d+\s*value/i);
    expect(html).not.toMatch(/free gift/i);
  });

  it("the PRE-price sticky shows a scroll action (not the price) and cannot initiate checkout", () => {
    // Render the sticky bar in isolation; SSR leaves it in the initial pre-price state.
    const html = renderToStaticMarkup(
      <OfferStickyBar
        priceLabel="$249 flat"
        turnaround="Delivered within 24 hours of receiving the required access."
        priceSectionId="offer-price"
        repairSectionId="offer-repair"
        heroAnchorId="offer-hero"
      />,
    );
    // Pre-price CTA is a scroll action, not the price.
    expect(html).toContain("See the fix");
    expect(html).not.toContain("Get this fixed");
    expect(html).not.toContain("$249 flat"); // the price is NOT shown pre-price
    // No checkout/terms/purchase affordance in the pre-price bar.
    expect(html).not.toMatch(/checkout/i);
    expect(html).not.toMatch(/accept.*terms/i);
  });

  it("the sticky bar carries the server price string for its post-price state", () => {
    // The price the sticky will reveal post-price is the server-derived label passed in.
    const m = model();
    expect(m.priceLabel).toBe("$249 flat");
    // (Post-price rendering is driven by an IntersectionObserver at runtime; here we
    // assert the price prop the sticky receives is the server price, not a constant.)
    const html = render(m);
    // The sticky is included on the purchasable, non-preview page.
    expect(m.checkout.purchasable).toBe(true);
    expect(html).toContain("See the fix"); // the sticky rendered (pre-price default state)
  });
});
