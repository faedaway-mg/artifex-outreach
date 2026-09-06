import { describe, it, expect } from "vitest";
import { classifyVideoPurpose, outreachBarReason } from "./video-classification";

describe("mandate 25 — canonical video purpose classification", () => {
  it("PROPOSAL by strong lineage (businessId / client- prefix / workflow=prospect)", () => {
    expect(classifyVideoPurpose({ id: "x", businessId: "lead_123" }).purpose).toBe("PROPOSAL");
    expect(classifyVideoPurpose({ id: "client-lead_123" }).purpose).toBe("PROPOSAL");
    expect(classifyVideoPurpose({ id: "x", workflow: "prospect" }).purpose).toBe("PROPOSAL");
  });
  it("CONTENT by lineage (workflow=social / catalog id / authored topic id)", () => {
    expect(classifyVideoPurpose({ id: "004", workflow: "social" }).purpose).toBe("CONTENT");
    expect(classifyVideoPurpose({ id: "004" }).purpose).toBe("CONTENT");
    expect(classifyVideoPurpose({ id: "status-meeting" }).purpose).toBe("CONTENT");
  });
  it("NEEDS_CLASSIFICATION for ambiguous records — never guessed", () => {
    expect(classifyVideoPurpose({ id: "X_LEGACY_9" }).purpose).toBe("NEEDS_CLASSIFICATION"); // uppercase/underscore, no lineage
    expect(classifyVideoPurpose({}).purpose).toBe("NEEDS_CLASSIFICATION");
  });
  it("business binding beats an id that looks like a field note (lineage wins)", () => {
    expect(classifyVideoPurpose({ id: "004", businessId: "lead_9" }).purpose).toBe("PROPOSAL");
  });
  it("outreach boundary: only PROPOSAL may enter outreach; CONTENT + unclassified are barred", () => {
    expect(outreachBarReason({ id: "client-lead_1" })).toBeNull();
    expect(outreachBarReason({ id: "004" })).toMatch(/content video/i);
    expect(outreachBarReason({ id: "X_LEGACY_9" })).toMatch(/unclassified/i);
  });
});
