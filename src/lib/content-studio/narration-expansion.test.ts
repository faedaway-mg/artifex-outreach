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

  it("no screenshot → still expands (findings ground the text; screenshot is a render prerequisite)", () => {
    const r = expandAndPersonalize({ ...full(), hasScreenshot: false });
    expect(r.available).toBe(true);
    expect(r.usedEvidenceIds).toContain("ev_booking");
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
    expect(expandAndPersonalize(full(), { variant: 2 }).narration).toBe(expandAndPersonalize(full(), { variant: 2 }).narration);
  });
});

describe("mandate 26 §1A — regeneration yields a genuinely different grounded candidate", () => {
  it("variant 0 preserved; variant 1 differs but stays company-specific + evidence-grounded", () => {
    const v0 = expandAndPersonalize(full(), { variant: 0 });
    const v1 = expandAndPersonalize(full(), { variant: 1 });
    expect(v1.narration).not.toBe(v0.narration);        // materially different text
    expect(v1.narration).toContain("Vertex Roofing");    // still company-specific
    expect(v1.usedEvidenceIds).toContain("ev_booking");  // still grounded in the same evidence
    expect(v1.quality?.signals.unsupportedClaims.length).toBe(0); // no fabrication introduced
    expect(v1.noSafeAlternative).toBe(false);
  });

  it("reports several distinct variants and every in-range variant is unique + grounded", () => {
    const r0 = expandAndPersonalize(full());
    expect(r0.variantCount).toBeGreaterThanOrEqual(3);
    const seen = new Set<string>();
    for (let v = 0; v < r0.variantCount; v++) {
      const r = expandAndPersonalize(full(), { variant: v });
      expect(r.available).toBe(true);
      expect(r.noSafeAlternative).toBe(false);
      expect(seen.has(r.narration)).toBe(false); // each in-range variant is distinct
      seen.add(r.narration);
      expect(r.usedEvidenceIds.length).toBeGreaterThan(0);
    }
  });

  it("no-safe-alternative: a variant beyond the distinct set is honestly flagged, not silently repeated", () => {
    const r0 = expandAndPersonalize(full());
    const beyond = expandAndPersonalize(full(), { variant: r0.variantCount + 5 });
    expect(beyond.available).toBe(true);
    expect(beyond.noSafeAlternative).toBe(true);
    expect(beyond.regenerationNote).toMatch(/materially different|add evidence|strongest grounded/i);
  });

  it("a single minimal finding still supports ≥2 distinct regenerations (phrasing rotation)", () => {
    const ev = { ...full(), findings: [{ id: "ev_x", observation: "your contact page has no phone number listed" }] };
    const r0 = expandAndPersonalize(ev, { variant: 0 });
    const r1 = expandAndPersonalize(ev, { variant: 1 });
    expect(r0.variantCount).toBeGreaterThanOrEqual(2);
    expect(r1.narration).not.toBe(r0.narration);
    expect(r1.noSafeAlternative).toBe(false);
  });
});
