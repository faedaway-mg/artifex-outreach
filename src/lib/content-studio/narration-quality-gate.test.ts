import { describe, it, expect } from "vitest";
import { gateNarration } from "./narration-quality-gate";
import { primaryCta } from "../intelligence/providers/website-intelligence";

// The exact failing narration from production.
const GENERIC = [
  "The homepage never quite tells a visitor what to do first.",
  "Point visitors to one clear next step",
  "Choose one primary action per page and make the secondary paths visibly secondary.",
  "Happy to walk you through it — no obligation.",
];

// A company-specific, evidence-led narration (~120 words) that should PASS every gate.
const GOOD = [
  "We went through Silver In the City's site the way a customer booking a service would.",
  "Your services page lists massage and facial treatments in detail, but every one of them ends with a phone number instead of a way to book online.",
  "Someone deciding at nine at night has to wait until morning to call, and a good share of them will book with a competitor who lets them reserve on the spot.",
  "We would connect a simple online booking widget to those service listings, so a visitor can choose a time and confirm without picking up the phone.",
  "It captures the customers you are currently losing after hours and takes work off your front desk.",
  "I can show you how it would fit your current pages.",
];

describe("gateNarration — narration quality + contradiction + similarity", () => {
  it("blocks noClearCTA when the page visibly has a prominent action (Free Consultation)", () => {
    const v = gateNarration({ narration: GOOD, finding: { key: "noClearCTA", observation: "No clear call-to-action" }, domFacts: { primaryCta: "Free Consultation" }, businessName: "Segal Cohen & Landis" });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("contradicted_by_screenshot");
  });

  it("fails a generic four-line narration", () => {
    const v = gateNarration({ narration: GENERIC, finding: { key: "noClearCTA" }, businessName: "Segal Cohen & Landis" });
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual(expect.arrayContaining(["insufficient_observed_detail", "too_short"]));
  });

  it("passes a company-specific, evidence-led narration", () => {
    const v = gateNarration({ narration: GOOD, finding: { key: "noOnlineBooking", observation: "no online booking" }, businessName: "Silver In the City" });
    expect(v.reasons).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.wordCount).toBeGreaterThanOrEqual(85);
  });

  it("fails a recommendation with no explained consequence", () => {
    const v = gateNarration({ narration: ["We reviewed Acme Dental's homepage and header navigation carefully.", "We would add a single prominent booking button to the header so the next step is obvious.", "It would sit right beside your services menu."], finding: { key: "noOnlineBooking" }, businessName: "Acme Dental" });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("consequence_not_explained");
  });

  it("fails unsupported business-impact claims", () => {
    const claim = [...GOOD.slice(0, 4), "This will increase your conversions by 40% and double your revenue within a month."];
    const v = gateNarration({ narration: claim, finding: { key: "noOnlineBooking" }, businessName: "Silver In the City" });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("unsupported_claim");
  });

  it("fails a template-equivalent script (same skeleton, swapped name)", () => {
    const peerLines = GOOD.map((l) => l.replace(/Silver In the City/g, "Morris Automotive"));
    const v = gateNarration({ narration: GOOD, finding: { key: "noOnlineBooking" }, businessName: "Silver In the City", peers: [{ businessName: "Morris Automotive", lines: peerLines }] });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("template_equivalent");
  });

  it("flags the generic script as template_equivalent to the known skeleton", () => {
    const v = gateNarration({ narration: GENERIC, finding: { key: "noClearCTA" }, businessName: "Anyco" });
    expect(v.reasons).toContain("template_equivalent");
  });
});

describe("primaryCta — recognizes consultation CTAs (Segal root cause)", () => {
  it("detects a Free Consultation button (with nested markup)", () => {
    expect(primaryCta('<a href="/contact" class="btn"><span>Free Consultation</span></a>')).toMatch(/consultation/i);
    expect(primaryCta('<button>Schedule a Consultation</button>')).toMatch(/consultation/i);
  });
  it("still returns empty when there is genuinely no action", () => {
    expect(primaryCta('<a href="/about">About our history</a><p>Welcome</p>')).toBe("");
  });
});
