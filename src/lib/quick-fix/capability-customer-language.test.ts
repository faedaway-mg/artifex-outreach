// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY COPY IS PLAIN-LANGUAGE — every sellable capability, once productized
// into a real offer via generateOffer, must pass the customer-language (no-jargon)
// gate with ZERO problems, and produce no CUSTOMER_LANGUAGE readiness BLOCKER.
//
// This locks the fix: the customer-facing scope copy (solutionSummary → proposedSolution,
// includedItems, excludedItems) may not leak an unexplained acronym (CTA/SEO/WCAG…),
// an internal SKU key, or developer/marketing jargon (metadata/funnel…). Each capability
// is driven by a finding that deterministically routes to it, so the offer really uses
// THAT capability's copy.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { generateOffer } from "./offer-engine";
import { CAPABILITIES, matchCapability, isSellable, type Capability } from "./capabilities";
import { assessCustomerLanguage, assessOfferCustomerLanguage } from "./customer-language";
import { checkNoJargon } from "./offer-readiness";
import type { OfferFinding } from "./types";

// A plain-language finding observation per capability that deterministically routes to
// THAT capability (contains its hint(s) and no stronger-matching rival hint). Observations
// are themselves jargon-clean so the derived problemBeingSolved introduces no jargon the
// capability copy did not. Each is asserted to route correctly below.
const OBSERVATION: Record<string, string> = {
  "cta-repair": "The main booking button is hard to find on the homepage.",
  "contact-form-repair": "The contact form submission appears to be failing.",
  "metadata-seo-cleanup": "The page title is a duplicate placeholder on several pages.",
  "analytics-install": "There is no analytics on the site, so nothing is measured.",
  "mobile-layout-fix": "On a small screen the layout breaks and is not mobile friendly.",
  "trust-signal-install": "The reviews and each testimonial the owner already has are hidden from where buyers decide.",
  "accessibility-quickfix": "A screen reader cannot read the images because contrast is poor.",
  "lead-capture-package": "The whole lead capture path is weak: the lead flow stalls and there is no online booking to schedule.",
  "homepage-conversion-sprint": "The homepage first impression is weak and the value proposition is unclear.",
};

function findingFor(cap: Capability): OfferFinding {
  const observation = OBSERVATION[cap.key] ?? cap.matchHints[0];
  return {
    id: `f_${cap.key}`,
    category: cap.addressesCategories[0],
    observation,
    whyItMatters: "It affects how visitors take the next step.",
    confidenceLabel: "Observed",
    confidenceScore: 0.95,
    impactLevel: "High",
    basis: ["link: https://acme.example/page"],
  };
}

const gen = (finding: OfferFinding) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings: [finding], generatedAt: null });

describe("capability copy passes the customer-language gate", () => {
  it("every capability's raw customer-facing strings are jargon-clean", () => {
    for (const cap of CAPABILITIES) {
      const strings = [cap.solutionSummary, ...cap.includedItems, ...cap.excludedItems];
      for (const s of strings) {
        const r = assessCustomerLanguage(s);
        expect(r.passes, `${cap.key} :: "${s}" :: ${r.problems.join(" | ")}`).toBe(true);
      }
    }
  });

  it("each finding routes to a sellable capability (offer really uses that copy)", () => {
    for (const cap of CAPABILITIES) {
      if (!isSellable(cap)) continue;
      const matched = matchCapability(findingFor(cap));
      expect(matched?.key, `finding for ${cap.key} did not route to it`).toBe(cap.key);
    }
  });

  it("a real productized offer for EACH capability passes assessOfferCustomerLanguage", () => {
    for (const cap of CAPABILITIES) {
      if (!isSellable(cap)) continue;
      const offer = gen(findingFor(cap));
      expect(offer.quickFixEligible, `${cap.key} did not productize: ${offer.notEligibleReason ?? ""}`).toBe(true);
      // The offer's scope copy comes from this capability.
      expect(offer.capabilityKeys).toContain(cap.key);

      const res = assessOfferCustomerLanguage(offer);
      expect(res.passes, `${cap.key} offer jargon: ${res.problems.join(" | ")}`).toBe(true);
    }
  });

  it("each offer produces NO CUSTOMER_LANGUAGE readiness BLOCKER (checkNoJargon)", () => {
    for (const cap of CAPABILITIES) {
      if (!isSellable(cap)) continue;
      const offer = gen(findingFor(cap));
      // checkNoJargon runs assessOfferCustomerLanguage over the offer scope (+ any
      // extra copy). With clean scope copy and no extra, it must return zero blockers.
      const issues = checkNoJargon({ offer, evidence: {} as never });
      expect(
        issues.filter((i) => i.severity === "BLOCKER"),
        `${cap.key} jargon blockers: ${issues.map((i) => i.observed).join(" | ")}`,
      ).toEqual([]);
    }
  });
});
