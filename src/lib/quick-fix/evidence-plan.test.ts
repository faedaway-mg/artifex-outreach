// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE PLAN — proof-before-capture (§16/§18/§19).
//
// Proves: a mobile/phone/responsive finding REQUIRES a mobile shot; the plan is
// UNSATISFIED when that mobile shot is absent (and reports it as missing); a
// general finding is proven on desktop; expectedShots is always 2–5; and an
// ad-hoc scope plans the same way. Pure + deterministic — no I/O.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  buildEvidencePlan,
  evidencePlanSatisfied,
  type AvailableShot,
} from "./evidence-plan";

describe("buildEvidencePlan — a mobile claim requires a mobile shot", () => {
  it("marks a mobile/phone/responsive finding as a mobile claim requiring a MOBILE viewport", () => {
    const plan = buildEvidencePlan({
      id: "cta",
      observation: "the primary CTA button is hard to find on mobile",
      whyItMatters: "visitors on a phone can't take the next step",
    });
    expect(plan.mobileClaim).toBe(true);
    expect(plan.requiredViewports).toContain("mobile");
    // A required mobile shot must actually exist in the expected set.
    const mobileShot = plan.expectedShots.find((s) => s.viewport === "mobile" && s.required);
    expect(mobileShot).toBeTruthy();
    expect(plan.findingId).toBe("cta");
  });

  it("detects the mobile signal via 'phone' and 'responsive' too", () => {
    for (const text of ["looks broken on a phone", "the responsive layout collapses"]) {
      expect(buildEvidencePlan({ observation: text }).mobileClaim).toBe(true);
      expect(buildEvidencePlan({ observation: text }).requiredViewports).toContain("mobile");
    }
  });

  it("a general (non-mobile) finding is proven on DESKTOP, not requiring mobile", () => {
    const plan = buildEvidencePlan({
      id: "meta",
      observation: "the homepage is missing page titles and descriptions",
      whyItMatters: "search engines can't describe your page",
    });
    expect(plan.mobileClaim).toBe(false);
    expect(plan.requiredViewports).toContain("desktop");
    expect(plan.requiredViewports).not.toContain("mobile");
  });

  it("expectedShots is always between 2 and 5", () => {
    const mobile = buildEvidencePlan({ observation: "the menu is unusable on mobile" });
    const general = buildEvidencePlan({ observation: "the hero has no clear headline" });
    for (const plan of [mobile, general]) {
      expect(plan.expectedShots.length).toBeGreaterThanOrEqual(2);
      expect(plan.expectedShots.length).toBeLessThanOrEqual(5);
    }
  });

  it("plans from an ad-hoc scope (no finding object) with a custom page", () => {
    const plan = buildEvidencePlan({ claim: "checkout is confusing on a phone", page: "Your checkout page", id: "scope_1" });
    expect(plan.mobileClaim).toBe(true);
    expect(plan.requiredViewports).toContain("mobile");
    expect(plan.page).toBe("Your checkout page");
    expect(plan.findingId).toBe("scope_1");
  });
});

describe("evidencePlanSatisfied — a mobile claim with no mobile shot is UNSATISFIED (§19)", () => {
  const mobilePlan = buildEvidencePlan({ observation: "the CTA is hidden on mobile" });

  it("is unsatisfied and reports 'mobile' missing when only a desktop shot exists", () => {
    const shots: AvailableShot[] = [{ viewport: "desktop", ready: true }];
    const res = evidencePlanSatisfied(mobilePlan, shots);
    expect(res.satisfied).toBe(false);
    expect(res.missing).toContain("mobile");
  });

  it("is unsatisfied when the mobile shot exists but is NOT ready", () => {
    const shots: AvailableShot[] = [{ viewport: "mobile", ready: false }];
    const res = evidencePlanSatisfied(mobilePlan, shots);
    expect(res.satisfied).toBe(false);
    expect(res.missing).toContain("mobile");
  });

  it("is satisfied once a READY mobile shot is available", () => {
    const shots: AvailableShot[] = [{ viewport: "mobile", ready: true }];
    const res = evidencePlanSatisfied(mobilePlan, shots);
    expect(res.satisfied).toBe(true);
    expect(res.missing).toEqual([]);
  });

  it("a general claim is satisfied by a READY desktop shot alone", () => {
    const plan = buildEvidencePlan({ observation: "the hero lacks a headline" });
    const res = evidencePlanSatisfied(plan, [{ viewport: "desktop", ready: true }]);
    expect(res.satisfied).toBe(true);
    expect(res.missing).toEqual([]);
  });
});
