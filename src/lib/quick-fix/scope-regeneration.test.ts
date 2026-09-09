// ─────────────────────────────────────────────────────────────────────────────
// SCOPE REGENERATION (Mandate Parts N/O/AB, Part AE items 21-24) — proves the pure
// translation of a FROZEN, jargon-laden offer scope into the CURRENT plain-language
// capability copy:
//   • a jargon-frozen offer NEEDS regeneration, and its regenerated scope has ZERO
//     customer-language problems (item 21/22);
//   • regeneration NEVER changes scope SEMANTICS (price / SKU / capabilityKeys /
//     problem statement / delivery window / access) — copy only (item 23);
//   • an already-plain, current-policy offer needs NOTHING (item 24).
// Pure + deterministic — no store, no sends, no writes.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  regeneratePlainScope,
  offerNeedsScopeRegeneration,
} from "./scope-regeneration";
import { assessOfferCustomerLanguage } from "./customer-language";
import { capabilityByKey } from "./capabilities";
import { PERSUASION_POLICY_VERSION } from "./offer-readiness";
import type { OfferScope } from "./types";
import type { StoredOffer } from "./store";

// ── Fixture builder ───────────────────────────────────────────────────────────
function storedOffer(scope: OfferScope, over: Partial<StoredOffer> = {}): StoredOffer {
  return {
    offerId: "qfo_abc123", leadId: "lead_1", companyName: "Acme Dental",
    findingIds: ["f1"], capabilityKeys: ["cta-repair"],
    band: "ENTRY", priceCents: 24900, currency: "usd",
    scope,
    evidenceGrade: "OBSERVED", confidence: 0.92,
    rationale: "Operator-facing: strong CTA-repair SKU match, GA4 tracking gap noted.", // internal jargon OK
    economics: {
      priceCents: 24900, estimatedHours: 2, externalCostCents: 0, grossContributionCents: 24900,
      effectiveHourlyCents: 12450, deliveryRisk: "low", supportBurden: "low",
      clearsMarginGate: true, marginReasons: [],
    },
    maintenance: null,
    quickFixEligible: true, notEligibleReason: null,
    automationLevel: "ASSISTED", offerVersion: "abc123", state: "DRAFT", generatedAt: null,
    // StoredOffer-specific:
    approvalStatus: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    approvedBy: null, recipientEmail: null, shareToken: "tok", shareRevoked: false,
    persuasionPolicyVersion: PERSUASION_POLICY_VERSION,
    ...over,
  };
}

// A FROZEN scope written before the plain-language copy shipped: leans on bare
// acronyms (CTA / GA4 / SEO), an internal SKU key, and dev jargon (metadata,
// viewport) — every one of which trips the customer-language gate.
const FROZEN_JARGON_SCOPE: OfferScope = {
  offerName: "48-Hour CTA Repair",
  problemBeingSolved: "Observed: your primary contact button is hard to find on a phone, so visitors leave without acting.",
  proposedSolution: "We repair your CTA and clean up the page metadata so more visitors convert (via cta-repair).",
  includedItems: [
    "Reposition the CTA above the fold",
    "Fix the viewport so the button renders on mobile",
    "Tidy the SEO metadata and title tags",
  ],
  excludedItems: ["Full CRO program", "New CMS build"],
  customerInputsRequired: ["Editor/admin access to your website platform"],
  deliveryWindow: "Delivered within 48 hours of receiving the required access.",
  revisionPolicy: "One round of adjustments within 7 days of delivery.",
};

describe("scope-regeneration — jargon-frozen offer (Part AE 21-23)", () => {
  it("21. a jargon-frozen offer NEEDS regeneration (customer-language problems present)", () => {
    const offer = storedOffer(FROZEN_JARGON_SCOPE);

    // Sanity: the frozen scope really does trip the gate today.
    const before = assessOfferCustomerLanguage(offer);
    expect(before.problems.length).toBeGreaterThan(0);

    const need = offerNeedsScopeRegeneration(offer);
    expect(need.needs).toBe(true);
    expect(need.reasons.join(" ")).toMatch(/customer-language gate/);
  });

  it("22. the REGENERATED scope has ZERO customer-language problems", () => {
    const offer = storedOffer(FROZEN_JARGON_SCOPE);
    const next = regeneratePlainScope(offer);

    const after = assessOfferCustomerLanguage({ ...offer, scope: next });
    expect(after.passes).toBe(true);
    expect(after.problems).toEqual([]);

    // And an offer carrying the regenerated scope no longer needs regeneration on
    // language grounds (policy is already current in this fixture).
    const need = offerNeedsScopeRegeneration({ ...offer, scope: next });
    expect(need.needs).toBe(false);
  });

  it("23. regeneration changes COPY only — price / SKU / keys / problem / delivery / access preserved", () => {
    const offer = storedOffer(FROZEN_JARGON_SCOPE);
    const next = regeneratePlainScope(offer);

    // Commercial + evidence semantics are byte-identical.
    expect(offer.priceCents).toBe(24900); // helper never touches price
    expect(next.problemBeingSolved).toBe(FROZEN_JARGON_SCOPE.problemBeingSolved);
    expect(next.deliveryWindow).toBe(FROZEN_JARGON_SCOPE.deliveryWindow);
    expect(next.customerInputsRequired).toEqual(FROZEN_JARGON_SCOPE.customerInputsRequired);

    // The re-sourced copy matches the CURRENT capability registry (not re-derived by hand).
    const cap = capabilityByKey("cta-repair")!;
    expect(next.proposedSolution).toBe(cap.solutionSummary);
    expect(next.includedItems).toEqual(cap.includedItems);
    expect(next.excludedItems).toEqual(cap.excludedItems);
    expect(next.revisionPolicy).toBe(cap.revisionPolicy);

    // Delivery-label prefix preserved on the name; noun re-sourced to the plain title.
    expect(next.offerName).toBe(`48-Hour ${cap.customerTitle}`);

    // The copy actually CHANGED (this was a real translation, not a no-op).
    expect(next.proposedSolution).not.toBe(FROZEN_JARGON_SCOPE.proposedSolution);
    expect(next.offerName).not.toBe(FROZEN_JARGON_SCOPE.offerName);
  });

  it("stale persuasion-policy alone triggers regeneration need even when copy is clean", () => {
    const cap = capabilityByKey("cta-repair")!;
    const cleanButStale = storedOffer(
      {
        offerName: `48-Hour ${cap.customerTitle}`,
        problemBeingSolved: "Your main contact button is hard to find on a phone.",
        proposedSolution: cap.solutionSummary,
        includedItems: cap.includedItems,
        excludedItems: cap.excludedItems,
        customerInputsRequired: ["Editor access to your website"],
        deliveryWindow: "Delivered within 48 hours of receiving access",
        revisionPolicy: cap.revisionPolicy,
      },
      { persuasionPolicyVersion: "persuasion.v0" }, // older policy
    );

    // Copy is clean...
    expect(assessOfferCustomerLanguage(cleanButStale).passes).toBe(true);
    // ...but the stale policy stamp still flags it for regeneration.
    const need = offerNeedsScopeRegeneration(cleanButStale);
    expect(need.needs).toBe(true);
    expect(need.reasons.join(" ")).toMatch(/persuasion-policy stale/);
  });
});

describe("scope-regeneration — already-plain current offer (Part AE 24)", () => {
  it("24. an already-plain, current-policy offer needs NOTHING", () => {
    const cap = capabilityByKey("cta-repair")!;
    const cleanScope: OfferScope = {
      offerName: `48-Hour ${cap.customerTitle}`,
      problemBeingSolved: "Your main contact button is hard to find on a phone.",
      proposedSolution: cap.solutionSummary,
      includedItems: cap.includedItems,
      excludedItems: cap.excludedItems,
      customerInputsRequired: ["Editor access to your website"],
      deliveryWindow: "Delivered within 48 hours of receiving access",
      revisionPolicy: cap.revisionPolicy,
    };
    const offer = storedOffer(cleanScope);

    expect(assessOfferCustomerLanguage(offer).passes).toBe(true);
    const need = offerNeedsScopeRegeneration(offer);
    expect(need.needs).toBe(false);
    expect(need.reasons).toEqual([]);

    // Regenerating an already-plain offer is idempotent on the copy fields.
    const next = regeneratePlainScope(offer);
    expect(next.proposedSolution).toBe(cleanScope.proposedSolution);
    expect(next.includedItems).toEqual(cleanScope.includedItems);
    expect(next.excludedItems).toEqual(cleanScope.excludedItems);
    expect(next.offerName).toBe(cleanScope.offerName);
    expect(assessOfferCustomerLanguage({ ...offer, scope: next }).passes).toBe(true);
  });
});
