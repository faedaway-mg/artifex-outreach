import { describe, it, expect } from "vitest";
import { assessPackageCompleteness, type CompletenessInput } from "./package-completeness";

function base(over: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    hasFinding: true,
    hasSubject: true,
    screenshotStatus: "READY",
    emailSafe: true,
    pdfRenderable: true,
    offerPageReady: true,
    evergreenStatus: "READY",
    personalizedVideo: { required: false, status: "READY" },
    evidenceStale: false,
    policyStale: false,
    ...over,
  };
}

describe("package completeness / materialization chain", () => {
  it("a fully-materialized package with no required PV is complete", () => {
    const c = assessPackageCompleteness(base());
    expect(c.complete).toBe(true);
    expect(c.cheapComplete).toBe(true);
    expect(c.missing).toEqual([]);
    expect(c.stale).toEqual([]);
    expect(c.waitingForPaidOnly).toBe(false);
  });

  it("lists cheap missing links (subject/screenshots/pdf) as cheap repairs (§6)", () => {
    const c = assessPackageCompleteness(base({ hasSubject: false, screenshotStatus: "MISSING", pdfRenderable: false }));
    expect(c.complete).toBe(false);
    const keys = c.missing.map((d) => d.dep);
    expect(keys).toContain("subject");
    expect(keys).toContain("evidence-screenshots");
    expect(keys).toContain("diagnostic-pdf");
    // All of these are cheap deterministic regenerations.
    expect(c.cheapRepairs.every((d) => d.cheap)).toBe(true);
    expect(c.cheapRepairs.length).toBeGreaterThanOrEqual(3);
  });

  it("separates a required-but-missing personalized video as WAITING_FOR_PAID, not blocked (§7)", () => {
    const c = assessPackageCompleteness(base({ personalizedVideo: { required: true, status: "MISSING" } }));
    expect(c.cheapComplete).toBe(true);
    expect(c.complete).toBe(false);
    expect(c.waitingForPaidOnly).toBe(true);
    const pv = c.dependencies.find((d) => d.dep === "personalized-video");
    expect(pv?.status).toBe("WAITING_FOR_PAID");
    expect(pv?.paid).toBe(true);
  });

  it("marks a stale personalized video as a PAID re-render", () => {
    const c = assessPackageCompleteness(base({ personalizedVideo: { required: true, status: "STALE" } }));
    expect(c.waitingForPaidOnly).toBe(true);
  });

  it("treats stale dependent assets as gaps, not present (§4)", () => {
    const c = assessPackageCompleteness(base({ evidenceStale: true }));
    expect(c.complete).toBe(false);
    const staleKeys = c.stale.map((d) => d.dep);
    expect(staleKeys).toContain("evidence-screenshots");
    expect(staleKeys).toContain("diagnostic-pdf");
  });

  it("marks copy as STALE when prepared under an older policy (§4)", () => {
    const c = assessPackageCompleteness(base({ policyStale: true }));
    const copy = c.stale.find((d) => d.dep === "email-copy");
    expect(copy?.status).toBe("STALE");
    expect(copy?.cheap).toBe(true);
  });

  it("a missing evergreen explainer is a non-cheap gap (§24)", () => {
    const c = assessPackageCompleteness(base({ evergreenStatus: "MISSING" }));
    const eg = c.missing.find((d) => d.dep === "evergreen-explainer");
    expect(eg).toBeTruthy();
    expect(eg?.cheap).toBe(false);
    expect(c.cheapComplete).toBe(false);
  });

  it("a missing finding is a non-cheap gap (must retire, not dress up)", () => {
    const c = assessPackageCompleteness(base({ hasFinding: false }));
    const f = c.missing.find((d) => d.dep === "finding");
    expect(f?.cheap).toBe(false);
  });
});
