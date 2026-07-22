import { describe, it, expect, beforeAll } from "vitest";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { buildConsultingRead } from "./consulting-read";
import { isCleanVoice } from "./voice-engine";
import type { BusinessProfile } from "../business-intelligence/types";
import type { Lead } from "../types";

describe("consulting read — judgment, not data", () => {
  let lead: Lead;
  let profile: BusinessProfile;

  beforeAll(async () => {
    lead = makeLead({ businessName: "Studio Smiles", industry: "Dental practice", city: "Los Angeles", rating: 4.8, reviewCount: 300 });
    profile = (await analyzeBusiness({ lead, findings: [], contacts: [] })).businessProfile;
  });

  it("surfaces exactly three things that matter, plus one objective/unknown/risk", () => {
    const r = buildConsultingRead(lead, profile);
    expect(r.threeThingsThatMatter).toHaveLength(3);
    for (const t of r.threeThingsThatMatter) expect(t.length).toBeGreaterThan(20);
    expect(r.biggestUnknown.length).toBeGreaterThan(20);
    expect(r.meetingObjective.length).toBeGreaterThan(15);
    expect(r.biggestRisk.length).toBeGreaterThan(15);
  });

  it("for a well-reviewed business, leads with trust/respect (not 'you have problems')", () => {
    const r = buildConsultingRead(lead, profile);
    expect(r.threeThingsThatMatter[0].toLowerCase()).toMatch(/trust|respect/);
    // relationship judgment appears
    expect(r.threeThingsThatMatter.join(" ").toLowerCase()).toContain("relationships");
  });

  it("objective is a single, calm sentence — never 'sell'", () => {
    const r = buildConsultingRead(lead, profile);
    expect(r.meetingObjective.toLowerCase()).not.toContain("sell");
    expect((r.meetingObjective.match(/[.?!]/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("reads in the Artifex voice — clean of clichés and hype", () => {
    const r = buildConsultingRead(lead, profile);
    const text = [...r.threeThingsThatMatter, r.biggestUnknown, r.meetingObjective, r.biggestRisk].join("\n");
    expect(isCleanVoice(text)).toBe(true);
  });
});
