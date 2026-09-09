// ─────────────────────────────────────────────────────────────────────────────
// TERMS v2 + LEGAL GATE + MAINTENANCE CONSENT — launch-readiness guarantees.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  TERMS_VERSION, CONTRACTING_ENTITY, TERMS_OPERATOR_APPROVED, TERMS_CLAUSES,
  renderTermsDocument, termsDocumentSha, buildTermsAcceptance, termsAcceptanceMatchesOffer,
} from "./terms";
import { legalGateBlocked } from "./purchase-safety";
import {
  maintenanceUpsellEnabled, buildMaintenanceConsent, maintenanceConsentText,
  MAINTENANCE_PLANS, MAINTENANCE_CONSENT_VERSION,
} from "./maintenance";
import type { QuickFixOffer } from "./types";

const offer = {
  offerId: "qfo_test", leadId: "lead_1", companyName: "Acme", offerVersion: "v1",
  capabilityKeys: ["cta-repair"], priceCents: 24900, currency: "usd",
  scope: { offerName: "CTA Repair", problemBeingSolved: "x", proposedSolution: "y", includedItems: ["a"], excludedItems: ["b"], customerInputsRequired: ["c"], deliveryWindow: "48 hours", revisionPolicy: "one round" },
} as unknown as QuickFixOffer;

describe("Quick-Fix terms v2 — operator-approved, no pending markers", () => {
  it("is version 2 and operator-approved", () => {
    expect(TERMS_VERSION).toBe("quickfix-terms-v2-2026-09");
    expect(TERMS_OPERATOR_APPROVED).toBe(true);
    expect(CONTRACTING_ENTITY).toContain("Faedaway M.G. LLC");
    expect(CONTRACTING_ENTITY).toContain("Artifex Labs");
  });
  it("contains NO pending/draft/legal-review markers anywhere in the terms text", () => {
    const doc = renderTermsDocument().toLowerCase();
    for (const marker of ["pending legal review", "pending review", "[pending", "draft", "legal review required"]) {
      expect(doc).not.toContain(marker);
    }
  });
  it("covers the approved commercial substance (all 20 sections + key clauses)", () => {
    expect(TERMS_CLAUSES.length).toBeGreaterThanOrEqual(20);
    const doc = renderTermsDocument();
    expect(doc.toLowerCase()).toContain("limitation of liability");
    expect(doc.toLowerCase()).toContain("aggregate liability");
    expect(doc).toContain("California");
    expect(doc).toContain("Los Angeles County");
    expect(doc.toLowerCase()).toContain("business days");
    expect(doc.toLowerCase()).toContain("seven calendar days");
  });
});

describe("acceptance record upgrade — immutable full snapshot", () => {
  it("freezes the exact terms document + SHA + full scope + digest", () => {
    const acc = buildTermsAcceptance({ offer, customerEmail: "b@x.com", acceptedAt: "2026-09-09T00:00:00Z" });
    expect(acc.termsVersion).toBe(TERMS_VERSION);
    expect(acc.contractingEntity).toBe(CONTRACTING_ENTITY);
    expect(acc.service).toBe("cta-repair");
    expect(acc.termsDocument).toBe(renderTermsDocument());
    expect(acc.termsDocumentSha).toBe(termsDocumentSha());
    expect(acc.termsDocumentSha).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.scopeSnapshot.priceCents).toBe(24900);
    expect(acc.scopeSnapshot.includedItems).toEqual(["a"]);
    // A new offer version invalidates the acceptance.
    expect(termsAcceptanceMatchesOffer(acc, offer)).toBe(true);
    expect(termsAcceptanceMatchesOffer(acc, { ...offer, offerVersion: "v2" })).toBe(false);
  });
});

describe("production legal gate — independent env switch", () => {
  it("blocks live purchases in production until QUICKFIX_LEGAL_APPROVED=true", () => {
    expect(legalGateBlocked({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toMatch(/legal review/i);
    expect(legalGateBlocked({ NODE_ENV: "production", QUICKFIX_LEGAL_APPROVED: "true" } as NodeJS.ProcessEnv)).toBeNull();
    expect(legalGateBlocked({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("recurring maintenance — separate consent, off by default", () => {
  it("upsell is disabled unless the flag AND a configured cancellation path are set", () => {
    expect(maintenanceUpsellEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(maintenanceUpsellEnabled({ QUICKFIX_MAINTENANCE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(maintenanceUpsellEnabled({ QUICKFIX_MAINTENANCE_ENABLED: "true", STRIPE_BILLING_PORTAL_CONFIGURED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("consent text is an explicit recurring authorization, and the record binds it", () => {
    const plan = MAINTENANCE_PLANS[0];
    const text = maintenanceConsentText(plan);
    expect(text).toContain("authorize");
    expect(text).toContain("every month");
    expect(text.toLowerCase()).toContain("cancel");
    const c = buildMaintenanceConsent({ offerId: "qfo_test", leadId: "lead_1", customerEmail: "b@x.com", plan, acceptedAt: "2026-09-09T00:00:00Z" });
    expect(c.cadence).toBe("month");
    expect(c.consentVersion).toBe(MAINTENANCE_CONSENT_VERSION);
    expect(c.monthlyCents).toBe(plan.monthlyCents);
    expect(c.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
