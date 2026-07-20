import { describe, it, expect } from "vitest";
import { analyzeBusiness } from "../intelligence/engine";
import { openingFromProfile } from "./adapters";
import { makeLead } from "../test-lead";

// The profile must be a first-class output of the engine — the single source of
// truth every downstream system reads.
describe("Engine integration", () => {
  it("attaches a Business Intelligence Profile to analyzeBusiness output", async () => {
    const bi = await analyzeBusiness({ lead: makeLead() });
    expect(bi.businessProfile).toBeDefined();
    expect(bi.businessProfile.leadId).toBe(bi.leadId);
    expect(bi.businessProfile.dimensions["digital-presence"]).toBeDefined();
    expect(bi.businessProfile.presence.profile).toBe("website");
  });

  it("keeps the profile consistent with the engine's evidence confidence", async () => {
    const bi = await analyzeBusiness({ lead: makeLead() });
    // The profile reuses the improvement model's evidence confidence — one source.
    expect(bi.businessProfile.evidenceConfidence).toBe(bi.improvement.dimensions.evidenceConfidence);
  });

  it("can drive the conversation opening straight from the engine's profile", async () => {
    const bi = await analyzeBusiness({ lead: makeLead({ website: null, socialLinks: ["https://facebook.com/x"], googleMapsUrl: null }) });
    const opening = openingFromProfile(bi.businessProfile);
    expect(opening.full.length).toBeGreaterThan(40);
    expect(opening.full).not.toMatch(/your (web ?site|site)\b/i);
  });
});
