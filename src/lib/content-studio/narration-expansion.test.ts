import { describe, it, expect } from "vitest";
import { expandAndPersonalize, type ExpansionEvidence } from "./narration-expansion";

const full = (): ExpansionEvidence => ({
  businessName: "Vertex Roofing",
  hasScreenshot: true,
  hasApprovedRecommendation: true,
  findings: [
    {
      id: "ev_booking",
      observation: "there's no online booking on your website, so a customer who searches for a roofer can't schedule a job without calling",
      impact: "a lot of people won't make that call after hours, so those jobs quietly slip away",
      recommendation: "add a simple booking page to the site you already have",
      benefit: "you'd capture those requests directly and see them the next morning",
    },
    {
      id: "ev_photos",
      observation: "your gallery hasn't been updated since 2021, so recent work isn't visible",
    },
  ],
});

describe("mandate 25 — expand-and-personalize composer", () => {
  it("grounds every material statement in a canonical evidence id", () => {
    const r = expandAndPersonalize(full());
    expect(r.available).toBe(true);
    expect(r.blocker).toBeNull();
    // Every non-boilerplate sentence carries at least one evidence id (or is flagged for review).
    for (const s of r.sentences) {
      if (s.section === "opening" || s.section === "cta") continue;
      expect(s.evidenceIds.length > 0 || s.requiresReview).toBe(true);
    }
    expect(r.usedEvidenceIds).toContain("ev_booking");
    expect(r.usedEvidenceIds).toContain("ev_photos");
  });

  it("produces a company-specific, adequately-long, non-fabricated draft graded GOOD/NEEDS_REVIEW", () => {
    const r = expandAndPersonalize(full());
    expect(r.narration).toContain("Vertex Roofing");
    expect(r.wordCount).toBeGreaterThan(40);
    expect(r.quality?.signals.companySpecific).toBe(true);
    expect(r.quality?.signals.unsupportedClaims.length).toBe(0);
    expect(["GOOD", "NEEDS_REVIEW"]).toContain(r.quality?.classification);
  });

  it("INSUFFICIENT EVIDENCE: no findings → produces NOTHING (never fabricates filler)", () => {
    const r = expandAndPersonalize({ ...full(), findings: [] });
    expect(r.available).toBe(false);
    expect(r.blocker).toMatch(/no verified findings/i);
    expect(r.sentences).toHaveLength(0);
    expect(r.narration).toBe("");
  });

  it("no screenshot → blocked, produces nothing", () => {
    const r = expandAndPersonalize({ ...full(), hasScreenshot: false });
    expect(r.available).toBe(false);
    expect(r.blocker).toMatch(/screenshot/i);
  });

  it("a finding without a verified impact yields a review-flagged why-it-matters (not an invented claim)", () => {
    const ev = full();
    ev.findings = [{ id: "ev_x", observation: "your contact page has no phone number listed" }];
    const r = expandAndPersonalize(ev);
    expect(r.available).toBe(true);
    // The why-it-matters sentence is flagged for review because there is no verified impact to ground it.
    expect(r.statementsRequiringReview.length).toBeGreaterThan(0);
    // and it contains no fabricated metric/result.
    expect(r.quality?.signals.unsupportedClaims.length).toBe(0);
  });

  it("is deterministic: identical evidence → identical draft", () => {
    expect(expandAndPersonalize(full()).narration).toBe(expandAndPersonalize(full()).narration);
  });
});
