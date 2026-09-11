import { describe, it, expect } from "vitest";
import { packageRepairPlan, type RepairPlanInput } from "./package-repair";

function base(over: Partial<RepairPlanInput> = {}): RepairPlanInput {
  return {
    eligible: true,
    retired: false,
    hasFinding: true,
    scopeNeedsRegen: false,
    subjectPersisted: true,
    subjectSpecific: true,
    approved: true,
    coherenceBlocks: false,
    screenshotsMissing: false,
    mobileRequired: false,
    mobilePresent: false,
    desktopPresent: true,
    websiteKnown: true,
    ...over,
  };
}

describe("packageRepairPlan (§4-9/§34/§38)", () => {
  it("a steady-state complete package plans NO actions (idempotent)", () => {
    const p = packageRepairPlan(base());
    expect(p.skip).toBeNull();
    expect(p.actions).toEqual([]);
  });

  it("skips a retired package", () => {
    expect(packageRepairPlan(base({ retired: true })).skip).toBe("retired");
  });

  it("skips a conversation-only package", () => {
    expect(packageRepairPlan(base({ eligible: false })).skip).toBe("conversation-only");
  });

  it("plans scope regen + subject persist + approval for a fresh unapproved package", () => {
    const p = packageRepairPlan(base({ scopeNeedsRegen: true, subjectPersisted: false, approved: false }));
    expect(p.regenScope).toBe(true);
    expect(p.persistSubject).toBe(true);
    expect(p.approve).toBe(true);
    expect(p.actions).toContain("scope-regenerated");
    expect(p.actions).toContain("subject-persisted");
    expect(p.actions).toContain("approved");
  });

  it("queues only the missing viewports; mobile only when required (§18/§19)", () => {
    expect(packageRepairPlan(base({ screenshotsMissing: true, desktopPresent: false, mobileRequired: false })).queueScreenshots).toEqual(["desktop"]);
    expect(packageRepairPlan(base({ screenshotsMissing: true, desktopPresent: true, mobileRequired: true, mobilePresent: false })).queueScreenshots).toEqual(["mobile"]);
    expect(packageRepairPlan(base({ screenshotsMissing: true, desktopPresent: false, mobileRequired: true, mobilePresent: false })).queueScreenshots).toEqual(["desktop", "mobile"]);
  });

  it("never queues screenshots when the website is unknown", () => {
    expect(packageRepairPlan(base({ screenshotsMissing: true, desktopPresent: false, websiteKnown: false })).queueScreenshots).toEqual([]);
  });

  it("never approves a package whose surfaces are incoherent (§13)", () => {
    const p = packageRepairPlan(base({ approved: false, coherenceBlocks: true }));
    expect(p.approve).toBe(false);
  });

  it("recommends retire when there is no finding, and never approves it (§10/§14)", () => {
    const p = packageRepairPlan(base({ hasFinding: false, approved: false }));
    expect(p.retireRecommended).toBe(true);
    expect(p.approve).toBe(false);
    expect(p.actions).toContain("retire-recommended");
  });

  it("recommends retire for a generic-only (non-specific-subject) weak package", () => {
    expect(packageRepairPlan(base({ subjectSpecific: false })).retireRecommended).toBe(true);
  });
});
