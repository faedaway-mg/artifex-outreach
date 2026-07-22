import { describe, it, expect, beforeAll } from "vitest";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { defaultSettings } from "../store";
import { buildOutreachKit } from "./kit";
import { scoreEmailQuality } from "./quality";
import { voiceViolations, isCleanVoice, readingSeconds } from "./voice-engine";
import type { BusinessProfile } from "../business-intelligence/types";
import type { Lead } from "../types";

describe("Artifex voice engine", () => {
  it("flags software/agency/AI tells and hype", () => {
    const bad = "Our analysis identified key gaps. We can leverage cutting-edge synergy to help!";
    const v = voiceViolations(bad).map((x) => x.id);
    expect(v).toContain("our-analysis");
    expect(v).toContain("leverage");
    expect(v).toContain("solutions");
    expect(v).toContain("synergy");
    expect(v).toContain("exclaim");
    expect(isCleanVoice(bad)).toBe(false);
  });
  it("passes calm, founder-written prose", () => {
    const good = "I'm Jordan — I run Artifex Labs. I noticed a couple of small things, and I could be wrong. No pressure either way.";
    expect(isCleanVoice(good)).toBe(true);
    expect(readingSeconds(good)).toBeGreaterThan(0);
  });
});

describe("email quality scoring", () => {
  let lead: Lead;
  let profile: BusinessProfile;

  beforeAll(async () => {
    lead = makeLead({ businessName: "Studio Smiles", industry: "Dental practice", rating: 4.8, reviewCount: 300 });
    profile = (await analyzeBusiness({ lead, findings: [], contacts: [] })).businessProfile;
  });

  it("every generated email passes the voice layer clean", () => {
    const kit = buildOutreachKit({ lead, profile, settings: defaultSettings(), contacts: [] });
    expect(isCleanVoice(kit.email.paragraphs.join("\n\n"))).toBe(true);
    expect(isCleanVoice(kit.followUp.paragraphs.join("\n\n"))).toBe(true);
  });

  it("scores a generated intro highly across the human dimensions", () => {
    const kit = buildOutreachKit({ lead, profile, settings: defaultSettings(), contacts: [] });
    const q = scoreEmailQuality(kit.email, { lead, profile });
    expect(q.dimensions.map((d) => d.name)).toEqual(
      expect.arrayContaining(["Founder Authenticity", "Specificity", "Curiosity", "Professionalism", "Personalization", "Clarity", "Reading Time", "Respectfulness"]),
    );
    for (const d of q.dimensions) {
      expect(d.stars).toBeGreaterThanOrEqual(1);
      expect(d.stars).toBeLessThanOrEqual(5);
      expect(d.detail).toBeTruthy();
    }
    expect(q.violations).toEqual([]);
    expect(q.overall).toBeGreaterThanOrEqual(75);
    expect(q.readingSeconds).toBeGreaterThan(15);
    expect(q.readingSeconds).toBeLessThan(60);
    expect(q.whyItWorks.length).toBeGreaterThan(0);
    // clean copy → founder authenticity should be strong
    expect(q.dimensions.find((d) => d.name === "Founder Authenticity")!.stars).toBeGreaterThanOrEqual(4);
  });

  it("penalizes marketing copy and suggests concrete edits", () => {
    const dirty = { subject: "x", paragraphs: ["Our platform detected issues.", "We leverage best-in-class solutions to grow your business!"] };
    const q = scoreEmailQuality(dirty, { lead, profile });
    expect(q.violations.length).toBeGreaterThan(0);
    expect(q.dimensions.find((d) => d.name === "Professionalism")!.stars).toBeLessThanOrEqual(3);
    expect(q.overall).toBeLessThan(75);
    expect(q.suggestedEdits.some((s) => /Remove/i.test(s))).toBe(true);
  });
});
