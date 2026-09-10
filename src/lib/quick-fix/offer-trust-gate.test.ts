// §16 fail-closed offer gate + durable ArtifactStore reporting. Proves a purchasable quick fix can NEVER
// present the $495 CTA while the required explainer video is missing/not-yet-rendered, that transcript
// metadata cannot satisfy readiness, and that the durable video store is reported honestly.
import { describe, it, expect } from "vitest";
import type { QuickFixOffer } from "./types";
import { buildOfferPageModel, type BuildOfferPageInput } from "./offer-page";
import { artifactStoreStatus } from "../content-studio/storage-factory";

function offer(over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "offer_abc", leadId: "lead_1", companyName: "Acme Roofing", findingIds: ["f1"], capabilityKeys: [],
    band: "ENTRY", priceCents: 49500, currency: "usd",
    scope: {
      offerName: "48-Hour Fix", problemBeingSolved: "Visitors can't book online — the booking button is broken on mobile.",
      proposedSolution: "Repair the booking path.", includedItems: ["Fix the booking button", "Verify on a phone"],
      excludedItems: ["unrelated redesign"], customerInputsRequired: ["site access"],
      deliveryWindow: "Delivered within 48 hours of receiving access", revisionPolicy: "one revision",
    } as any,
    evidenceGrade: "OBSERVED", confidence: 0.9, rationale: "op", economics: {} as any, maintenance: null,
    quickFixEligible: true, notEligibleReason: null, automationLevel: "ASSISTED", offerVersion: "v1",
    state: "APPROVED", generatedAt: "2026-09-01T00:00:00Z", ...over,
  } as unknown as QuickFixOffer;
}

const READY_EVERGREEN = {
  scope: "cta-conversion", assetUrl: "/api/quick-fix/trust-video/cta-conversion", posterUrl: "/api/quick-fix/trust-video/cta-conversion/poster",
  captionsUrl: null, title: "How the Artifex quick fix works", durationSeconds: 72, script: "We're Artifex Labs…", version: 3,
} as any;
const SCRIPT_ONLY_EVERGREEN = { ...READY_EVERGREEN, assetUrl: null, posterUrl: null }; // prepare-matt: transcript/metadata only

function model(evergreen: any, over: Partial<BuildOfferPageInput> = {}) {
  return buildOfferPageModel({
    offer: offer(), evergreen, approved: true, stripeConfigured: true, termsAccepted: true,
    superseded: false, bookingUrl: "https://cal.com/x", ...over,
  });
}

describe("§16 — a required explainer video gates the purchase CTA (fail-closed)", () => {
  it("MISSING explainer (no evergreen) → NOT purchasable, honest reason, trustVideo.ready=false", () => {
    const m = model(null);
    expect(m.checkout.purchasable).toBe(false);
    expect(m.checkout.buyEnabled).toBe(false);
    expect(m.trustVideo.ready).toBe(false);
    expect(m.checkout.reasons.join(" ")).toMatch(/explainer video is being prepared/);
  });

  it("SCRIPT-ONLY explainer (transcript/metadata but no playable asset) → NOT purchasable", () => {
    const m = model(SCRIPT_ONLY_EVERGREEN);
    expect(m.trustVideo.present).toBe(true);        // an evergreen record exists…
    expect(m.trustVideo.assetUrl).toBeNull();       // …but there is no playable video
    expect(m.trustVideo.ready).toBe(false);         // transcript metadata can NEVER satisfy readiness
    expect(m.checkout.purchasable).toBe(false);
  });

  it("READY explainer (durable bound asset with a playable url) → the trust gate does NOT block (existing valid offers unaffected)", () => {
    const m = model(READY_EVERGREEN);
    expect(m.trustVideo.ready).toBe(true);
    expect(m.trustVideo.assetUrl).toBe("/api/quick-fix/trust-video/cta-conversion");
    // the explainer reason is absent — a ready video never holds the offer (other readiness axes are separate)
    expect(m.checkout.reasons.join(" ")).not.toMatch(/explainer video is being prepared/);
  });

  it("a conversation-only offer needs no explainer (not a sales page) and is not gated by it", () => {
    const m = buildOfferPageModel({
      offer: offer({ quickFixEligible: false, notEligibleReason: "needs a conversation" } as any),
      evergreen: null, approved: true, stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://cal.com/x",
    });
    expect(m.conversationOnly).toBe(true);
    expect(m.trustVideo.ready).toBe(true); // not required on a conversation page
  });
});

describe("§16 — durable video ArtifactStore is reported honestly", () => {
  it("postgres provider → configured (durable production store)", () => {
    expect(artifactStoreStatus({ CS_STORAGE_PROVIDER: "postgres", DATABASE_URL: "postgres://x" } as any)).toEqual({ mode: "postgres", configured: true });
  });

  it("production with NO provider set → unconfigured (fail-closed, never silently local)", () => {
    expect(artifactStoreStatus({ NODE_ENV: "production" } as any)).toEqual({ mode: "unconfigured", configured: false });
  });

  it("dev local → not a durable PRODUCTION store (configured=false)", () => {
    expect(artifactStoreStatus({ NODE_ENV: "development" } as any)).toEqual({ mode: "local", configured: false });
  });
});
