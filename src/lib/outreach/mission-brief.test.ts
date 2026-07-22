import { describe, it, expect, beforeAll } from "vitest";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { defaultSettings } from "../store";
import { buildMissionBrief } from "./mission-brief";
import { isCleanVoice } from "./voice-engine";
import type { BusinessProfile } from "../business-intelligence/types";
import type { Lead } from "../types";

describe("discovery mission brief", () => {
  let lead: Lead;
  let profile: BusinessProfile;

  beforeAll(async () => {
    lead = makeLead({ businessName: "Studio Smiles", industry: "Dental practice", city: "Los Angeles", rating: 4.8, reviewCount: 300 });
    profile = (await analyzeBusiness({ lead, findings: [], contacts: [] })).businessProfile;
  });

  it("answers the seven questions a prepared operator needs", () => {
    const b = buildMissionBrief({ lead, profile, settings: defaultSettings(), contacts: [] });
    expect(b.executiveSummary).toContain("Studio Smiles");
    expect(b.executiveSummary.length).toBeGreaterThan(80);
    // meeting goal is about understanding, not selling
    expect(b.meetingGoal.toLowerCase()).not.toContain("sell them");
    expect(b.meetingGoal.toLowerCase()).toMatch(/understand|learn/);
    expect(b.recommendedOpening.length).toBeGreaterThan(30);
    expect(b.firstQuestions).toHaveLength(5);
    expect(new Set(b.firstQuestions).size).toBe(5); // no duplicates
    expect(b.successCriteria.toLowerCase()).toContain("if we leave today");
  });

  it("names what it does NOT know, and never asserts assumptions as facts", () => {
    const b = buildMissionBrief({ lead, profile, settings: defaultSettings(), contacts: [] });
    expect(b.assumptionsToAvoid.length).toBeGreaterThanOrEqual(1);
    expect(b.assumptionsToAvoid.join(" ").toLowerCase()).toContain("public information only");
  });

  it("only surfaces priorities the observations support, with confidence", () => {
    const b = buildMissionBrief({ lead, profile, settings: defaultSettings(), contacts: [] });
    for (const p of b.likelyPriorities) {
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(100);
      expect(p.basis).toBeTruthy();
    }
  });

  it("reads in the Artifex voice — clean of clichés and hype", () => {
    const b = buildMissionBrief({ lead, profile, settings: defaultSettings(), contacts: [] });
    const text = [b.executiveSummary, b.meetingGoal, b.recommendedOpening, b.successCriteria, ...b.firstQuestions].join("\n");
    expect(isCleanVoice(text)).toBe(true);
  });
});
