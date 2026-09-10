import { describe, it, expect } from "vitest";
import { classifyLegacyRecord, isArchivedDisposition, type LegacyClassifyInput } from "./legacy-classify";

const active = (over: Partial<LegacyClassifyInput> = {}): LegacyClassifyInput => ({
  leadId: "L1",
  businessName: "Greenville Family Dental",
  city: "Greenville",
  state: "SC",
  isSyntheticProvenance: false,
  isProspectVideoDemo: false,
  isSupersededExperiment: false,
  alreadyGeneratedHistorical: false,
  isDuplicateHistorical: false,
  isEnterpriseOrPublic: false,
  isFranchiseCorporateControlled: false,
  meetsCurrentIcpFit: true,
  inCurrentTargetMarket: true,
  ...over,
});

describe("legacy record classifier (§1-3)", () => {
  it("keeps a current in-market, in-ICP business active", () => {
    const c = classifyLegacyRecord(active());
    expect(c.disposition).toBe("active");
    expect(isArchivedDisposition(c.disposition)).toBe(false);
  });

  it("archives synthetic/test/demo provenance (never requalifiable)", () => {
    const c = classifyLegacyRecord(active({ isSyntheticProvenance: true }));
    expect(c.disposition).toBe("LEGACY_ARCHIVED");
    expect(c.requalifiable).toBe(false);
  });

  it("archives prospect-video demos, superseded experiments, already-generated & duplicate historical", () => {
    expect(classifyLegacyRecord(active({ isProspectVideoDemo: true })).disposition).toBe("LEGACY_ARCHIVED");
    expect(classifyLegacyRecord(active({ isSupersededExperiment: true })).disposition).toBe("LEGACY_ARCHIVED");
    expect(classifyLegacyRecord(active({ alreadyGeneratedHistorical: true })).disposition).toBe("LEGACY_ARCHIVED");
    expect(classifyLegacyRecord(active({ isDuplicateHistorical: true })).disposition).toBe("LEGACY_ARCHIVED");
  });

  it("disqualifies wrong company type (enterprise/public, corporate franchise) — e.g. Liberty Tax / Motion Recruitment fall out of the general rules", () => {
    // Liberty Tax — national franchise brand → corporate/enterprise type failure (not a hard-coded name)
    const libertyTax = classifyLegacyRecord(active({ businessName: "Liberty Tax", isEnterpriseOrPublic: true }));
    expect(libertyTax.disposition).toBe("DISQUALIFIED_LEGACY");
    // Motion Recruitment — national staffing enterprise
    const motion = classifyLegacyRecord(active({ businessName: "Motion Recruitment", isEnterpriseOrPublic: true }));
    expect(motion.disposition).toBe("DISQUALIFIED_LEGACY");
    expect(classifyLegacyRecord(active({ isFranchiseCorporateControlled: true })).disposition).toBe("DISQUALIFIED_LEGACY");
  });

  it("archives wrong-geography records (off current strategy, requalifiable)", () => {
    const c = classifyLegacyRecord(active({ city: "Los Angeles", state: "CA", inCurrentTargetMarket: false }));
    expect(c.disposition).toBe("LEGACY_ARCHIVED");
    expect(c.requalifiable).toBe(true);
  });

  it("disqualifies records that don't meet the current qualification model (no grandfathering)", () => {
    const c = classifyLegacyRecord(active({ meetsCurrentIcpFit: false }));
    expect(c.disposition).toBe("DISQUALIFIED_LEGACY");
  });

  it("provenance archival takes priority over other signals", () => {
    // synthetic AND enterprise → archived (provenance rule first)
    expect(classifyLegacyRecord(active({ isSyntheticProvenance: true, isEnterpriseOrPublic: true })).disposition).toBe("LEGACY_ARCHIVED");
  });
});
