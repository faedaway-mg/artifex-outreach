// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER OFFER PAGE — EVIDENCE RENDERING.
//
// Proves the personalized-proof rendering contract on the customer offer page:
//   • a READY screenshot renders a real <img> at its imageRoute (belonging to the
//     right offer's lead) — personalized proof, never fabricated;
//   • a MISSING screenshot renders NO image (no placeholder, no fabrication) and
//     falls back to the existing text evidence card instead;
//   • the personalized diagnostic video (MISSING today) renders NOTHING, while the
//     shared evergreen process video is still present (never substituted);
//   • the "View the full review (PDF)" link appears ONLY when the PDF is READY.
//
// The repo ships no @testing-library/react; like the existing ClosingWorkspace test
// we render to static markup with react-dom/server (already installed) and assert on
// the produced HTML. The interactive checkout/sticky islands are stubbed so the
// view renders in isolation. No sends, no charges — pure view assembly.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Stub the client islands (they render nothing load-bearing for these assertions).
vi.mock("./OfferCheckout", () => ({ OfferCheckout: () => null }));
vi.mock("./OfferStickyBar", () => ({ OfferStickyBar: () => null }));

import { OfferPageView } from "./OfferPageView";
import { buildOfferPageModel } from "@/lib/quick-fix/offer-page";
import { trustVideoAsEvergreen } from "@/lib/quick-fix/trust-videos";
import type { OfferPageModel } from "@/lib/quick-fix/offer-page";
import type { EvidencePackage, EvidenceScreenshot } from "@/lib/quick-fix/evidence-package";
import type { QuickFixOffer } from "@/lib/quick-fix/types";

const LEAD_ID = "lead_1";

const baseOffer = (over: Partial<QuickFixOffer> = {}) => ({
  offerId: "qfo_x", leadId: LEAD_ID, companyName: "Acme Co", offerVersion: "v1",
  findingIds: ["f1"], capabilityKeys: ["cta-repair"], priceCents: 24900, currency: "usd",
  quickFixEligible: true, notEligibleReason: null,
  scope: {
    offerName: "Booking & Contact Button Repair", problemBeingSolved: "The main button is unclear.",
    proposedSolution: "Clarify and repair the primary action.",
    includedItems: ["Clarify the primary action", "Verify the path"],
    excludedItems: ["Full redesign"], customerInputsRequired: ["website-admin"],
    deliveryWindow: "Delivered within 24 hours of receiving the required access.", revisionPolicy: "one round",
  },
  maintenance: null,
  ...over,
}) as unknown as QuickFixOffer;

function baseModel(offer: QuickFixOffer = baseOffer()): OfferPageModel {
  return buildOfferPageModel({
    offer, evergreen: trustVideoAsEvergreen(offer), approved: true,
    stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://x/book",
  });
}

const readyShot = (viewport: "mobile" | "desktop"): EvidenceScreenshot => ({
  id: `${LEAD_ID}:${viewport}`,
  imageRoute: `/api/content-studio/screenshot-image?business=${LEAD_ID}&viewport=${viewport}`,
  publicUrl: null,
  viewport,
  pageLabel: viewport === "mobile" ? "Your homepage on a phone" : "Your homepage on a computer",
  sourceUrl: "https://acme.example/",
  capturedAt: "2026-09-01T10:00:00Z",
  sha256: "abc123",
  status: "READY",
});
const missingShot = (viewport: "mobile" | "desktop"): EvidenceScreenshot => ({
  ...readyShot(viewport), sourceUrl: null, capturedAt: null, sha256: null, status: "MISSING",
});

function pkg(over: Partial<EvidencePackage> = {}): EvidencePackage {
  return {
    offerId: "qfo_x", leadId: LEAD_ID, company: "Acme Co", websiteUrl: "https://acme.example",
    screenshots: [readyShot("desktop"), readyShot("mobile")],
    screenshotStatus: "READY",
    findings: [{
      id: "f1", observation: "the primary CTA is hard to find on mobile",
      plain: "The main button is hard to find on a phone.",
      whyItMatters: "visitors can't take the next step", confidenceLabel: "Observed",
      confidenceScore: 0.95, screenshotId: `${LEAD_ID}:mobile`,
    }],
    personalizedVideo: { status: "MISSING", url: null, detail: "no generator" },
    diagnosticPdf: { status: "MISSING", url: null, detail: "no pdf" },
    evergreenVideo: { status: "READY", url: "/trust-videos/x.mp4", detail: "shared" },
    confidence: 0.9, evidenceGrade: "A", generatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const render = (model: OfferPageModel) => renderToStaticMarkup(<OfferPageView model={model} token="tok_1" />);

describe("customer offer page surfaces personalized proof", () => {
  it("a READY screenshot renders a real image at its imageRoute for the right offer's lead", () => {
    const html = render({ ...baseModel(), evidenceAssets: pkg() });
    // The real captured image is rendered via the app image route, scoped to this lead.
    // (The rendered <img src> HTML-escapes the "&" to "&amp;", so match around it.)
    expect(html).toContain(`/api/content-studio/screenshot-image?business=${LEAD_ID}`);
    expect(html).toContain("viewport=desktop");
    expect(html).toContain(`business=${LEAD_ID}`);
    expect(html).toContain("Evidence from your website");
    // Observed-evidence labeling (distinct from the illustrative example section).
    expect(html).toContain("Observed on your site");
    // The finding's PLAIN restatement (not the technical observation) is what customers read.
    expect(html).toContain("The main button is hard to find on a phone.");
    expect(html).not.toContain("primary CTA");
  });

  it("a MISSING screenshot renders NO image and falls back to the text evidence card", () => {
    const noShots = pkg({
      screenshots: [missingShot("desktop"), missingShot("mobile")],
      screenshotStatus: "MISSING",
    });
    const html = render({ ...baseModel(), evidenceAssets: noShots });
    // No fabricated image: the screenshot-image route must not appear at all.
    expect(html).not.toContain("/api/content-studio/screenshot-image");
    expect(html).not.toContain("Evidence from your website");
    // Text evidence fallback is shown instead.
    expect(html).toContain("Observed issue");
  });

  it("the personalized video (MISSING today) renders nothing; the evergreen process video stays", () => {
    const html = render({ ...baseModel(), evidenceAssets: pkg() });
    // No personalized-video slot.
    expect(html).not.toContain("Your personalized walkthrough");
    expect(html).not.toContain("About your site");
    // The shared evergreen "how it works" process video is still present and labeled as such.
    expect(html).toContain("How the Artifex quick fix works");
  });

  it("the diagnostic PDF link appears ONLY when the PDF is READY", () => {
    const missingPdf = render({ ...baseModel(), evidenceAssets: pkg() });
    expect(missingPdf).not.toContain("View the full review (PDF)");

    const readyPdf = render({
      ...baseModel(),
      evidenceAssets: pkg({ diagnosticPdf: { status: "READY", url: "/pdf/qfo_x.pdf", detail: "ready" } }),
    });
    expect(readyPdf).toContain("View the full review (PDF)");
    expect(readyPdf).toContain("/pdf/qfo_x.pdf");
  });
});
