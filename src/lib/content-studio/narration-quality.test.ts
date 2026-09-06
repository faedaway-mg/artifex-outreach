import { describe, it, expect } from "vitest";
import { evaluateNarrationQuality, DEFAULT_NARRATION_CONFIG } from "./narration-quality";

const finding = "No online booking on your website — customers who search can't schedule a job without calling.";
const ev = (over = {}) => ({ businessName: "Vertex Roofing", findings: [finding], hasScreenshot: true, hasApprovedRecommendation: true, ...over });

// ~110 words, company-specific, evidence-backed, recommendation + CTA → GOOD.
const GOOD = `Hi — I spent a few minutes on Vertex Roofing's website and one thing stood out. Right now there's no online booking on the site, so a customer who searches for a roofer and lands on your page can't actually schedule a job without picking up the phone. A lot of people won't make that call after hours, so those jobs quietly slip away. A simple booking page, right on the site you already have, could capture those requests directly and put them in front of you the next morning. It's a small change that could turn more of your website visitors into booked work. If it's useful, just reply and I'll walk you through what it would take.`;

describe("mandate 25 — narration quality evaluator", () => {
  it("duration estimate uses the configured speaking rate", () => {
    const r = evaluateNarrationQuality({ narration: "one two three four five six seven eight nine ten", evidence: ev() });
    expect(r.wordCount).toBe(10);
    expect(r.estimatedSeconds).toBe(Math.round((10 * 60) / DEFAULT_NARRATION_CONFIG.wordsPerMinute)); // 4s
  });

  it("GOOD: company-specific + evidence-backed + adequate", () => {
    const r = evaluateNarrationQuality({ narration: GOOD, evidence: ev() });
    expect(r.classification).toBe("GOOD");
    expect(r.signals.companySpecific).toBe(true);
    expect(r.estimatedSeconds).toBeGreaterThanOrEqual(35);
  });

  it("TOO_SHORT: brief and not company-specific", () => {
    const r = evaluateNarrationQuality({ narration: "Hi, I made a quick video for you. Take a look and let me know.", evidence: ev() });
    expect(r.classification).toBe("TOO_SHORT");
  });

  it("GENERIC: long but not company-specific (no evidence-backed observation)", () => {
    const generic = "Hi there. I wanted to reach out today because we help businesses like yours grow and reach more people every single day. We have a great deal of experience across many different industries and we genuinely think that we could really help you succeed and thrive going forward. So many companies just like yours have seen wonderful results when they decide to work together with our talented and dedicated team. We would truly love the chance to show you exactly what we can do and how we can make a real and lasting difference for your business over the coming weeks and months ahead. Please do let me know if you might be interested in learning a little more about everything that our services can offer you.";
    const r = evaluateNarrationQuality({ narration: generic, evidence: ev() });
    expect(r.classification).toBe("GENERIC");
    expect(r.signals.companySpecific).toBe(false);
  });

  it("UNSUPPORTED_CLAIMS: invented metric/result fails hard", () => {
    const r = evaluateNarrationQuality({ narration: `${GOOD} This will increase your revenue by 30% within a month, guaranteed.`, evidence: ev() });
    expect(r.classification).toBe("UNSUPPORTED_CLAIMS");
    expect(r.signals.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("INSUFFICIENT_EVIDENCE: no findings or no screenshot", () => {
    expect(evaluateNarrationQuality({ narration: GOOD, evidence: ev({ findings: [] }) }).classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(evaluateNarrationQuality({ narration: GOOD, evidence: ev({ hasScreenshot: false }) }).classification).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("TOO_SIMILAR: substantive wording reused across companies (only the name differs)", () => {
    const shared = "There's no online booking on the website so customers who search can't schedule a job without calling. A simple booking page could capture those requests directly.";
    const a = evaluateNarrationQuality({
      narration: `Hi — about Vertex Roofing. ${shared} Just reply if useful.`,
      evidence: ev(),
      otherScripts: [{ leadId: "other", narration: `Hi — about Cedar Dental. ${shared} Just reply if useful.` }],
    });
    expect(a.classification).toBe("TOO_SIMILAR");
    expect(a.signals.maxSimilarity).toBeGreaterThanOrEqual(DEFAULT_NARRATION_CONFIG.similarityThreshold);
  });

  it("a concise but specific script is NOT failed as TOO_SHORT/GENERIC", () => {
    const concise = "Hi — quick note on Vertex Roofing. Your website has no online booking, so searchers can't schedule a job without calling. A simple booking page could capture those requests. Reply if useful.";
    const r = evaluateNarrationQuality({ narration: concise, evidence: ev() });
    expect(["GOOD", "NEEDS_REVIEW"]).toContain(r.classification);
    expect(r.signals.companySpecific).toBe(true);
  });
});
