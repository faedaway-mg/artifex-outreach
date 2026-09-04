import { describe, it, expect } from "vitest";
import { reanalysisEligibility, classifyPrep, isAssembledPackageState, type PrepEligibilityInput } from "./reanalysis-eligibility";

// The canonical "may this company enter automatic new-outreach preparation / deep recapture?" selector.
// One rule, shared by cron/Today/Studio/count — so "being reanalyzed" can never hide a committed company.
const base: PrepEligibilityInput = {
  internal: false, pipelineStage: "Qualified", terminal: false, contacted: false, scheduled: false,
  suppressed: false, hasWebsite: true, recipientValid: true, packageState: null,
};

describe("reanalysisEligibility — canonical selector", () => {
  it("a clean, uncontacted, unscheduled lead with a website + recipient is eligible", () => {
    expect(reanalysisEligibility(base)).toEqual({ eligible: true, reason: null });
  });

  it("excludes contacted, scheduled, suppressed, terminal, internal", () => {
    expect(reanalysisEligibility({ ...base, contacted: true }).reason).toBe("contacted");
    expect(reanalysisEligibility({ ...base, scheduled: true }).reason).toBe("scheduled");
    expect(reanalysisEligibility({ ...base, suppressed: true }).reason).toBe("suppressed");
    expect(reanalysisEligibility({ ...base, terminal: true }).reason).toBe("terminal-stage");
    expect(reanalysisEligibility({ ...base, internal: true }).reason).toBe("internal");
  });

  it("requires a website AND a valid recipient", () => {
    expect(reanalysisEligibility({ ...base, hasWebsite: false }).reason).toBe("no-website");
    expect(reanalysisEligibility({ ...base, recipientValid: false }).reason).toBe("no-recipient");
  });

  it("an ASSEMBLED/FROZEN package blocks re-preparation; an INCOMPLETE draft does NOT", () => {
    expect(isAssembledPackageState("INCOMPLETE")).toBe(false);
    for (const s of ["READY_TO_APPROVE", "FROZEN", "SCHEDULED", "SENT"] as const) {
      expect(reanalysisEligibility({ ...base, packageState: s }).reason).toBe("assembled-package");
    }
    // INCOMPLETE = awaiting only the voiceover; still eligible for recapture/regeneration.
    expect(reanalysisEligibility({ ...base, packageState: "INCOMPLETE" }).eligible).toBe(true);
  });

  it("reason precedence: the strongest commitment wins the label", () => {
    // scheduled beats contacted; assembled beats contacted.
    expect(reanalysisEligibility({ ...base, scheduled: true, contacted: true }).reason).toBe("scheduled");
    expect(reanalysisEligibility({ ...base, contacted: true, packageState: "READY_TO_APPROVE" }).reason).toBe("assembled-package");
  });

  it("classifies the current-nine archetypes exactly (mandate part 2)", () => {
    // Cobalt Clean — scheduled email-only send.
    expect(classifyPrep(reanalysisEligibility({ ...base, scheduled: true }))).toBe("Scheduled — no reanalysis");
    // Robert Hall — contacted AND READY_TO_APPROVE (already assembled).
    expect(classifyPrep(reanalysisEligibility({ ...base, contacted: true, packageState: "READY_TO_APPROVE" }))).toBe("Already assembled — no reanalysis");
    // Morris Automotive — contacted, INCOMPLETE draft.
    expect(classifyPrep(reanalysisEligibility({ ...base, contacted: true, packageState: "INCOMPLETE" }))).toBe("Contacted — no reanalysis");
    // A genuinely eligible, uncontacted prospect.
    expect(classifyPrep(reanalysisEligibility(base))).toBe("Eligible for deep recapture");
  });
});
