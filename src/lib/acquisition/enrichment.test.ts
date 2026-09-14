import { describe, it, expect } from "vitest";
import { shouldEnrich } from "./enrichment";

// The architecture rule: enrichment spend happens ONLY after a lead earns a current
// action (PROVEN / OBSERVED) and only when it lacks a send-approved email. Every
// non-qualifying verdict must consume ZERO enrichment.
describe("post-qualification enrichment gate", () => {
  it("enriches an OUTREACH-ELIGIBLE (PROVEN) lead with no send-approved email", () => {
    expect(shouldEnrich({ verdict: "PROVEN", hasSendApprovedEmail: false })).toBe(true);
  });

  it("never enriches a PROVEN lead that already has a send-approved email (no waste)", () => {
    expect(shouldEnrich({ verdict: "PROVEN", hasSendApprovedEmail: true })).toBe(false);
  });

  it("never enriches OBSERVED or any non-PROVEN verdict (zero spend on non-outreach-eligible)", () => {
    for (const v of ["OBSERVED", "NO_MATERIAL_PROBLEM", "DISPROVEN", "NEEDS_MORE_EVIDENCE", "wrong-icp", "wrong-geography", null, undefined]) {
      expect(shouldEnrich({ verdict: v as any, hasSendApprovedEmail: false })).toBe(false);
    }
  });
});
