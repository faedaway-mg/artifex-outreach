import { describe, it, expect } from "vitest";
import { worst, rollupChecks, distribution, avg, pct, check } from "./types";
import { launchMetrics } from "./metrics";
import { platformHealth } from "./health";
import { readinessChecklist } from "./readiness";
import { runValidation } from "./validation";
import { launchConfidence } from "./confidence";
import { firstHundred } from "./first100";
import { dailyReview } from "./review";

describe("launch/types helpers", () => {
  it("worst() picks the most severe status", () => {
    expect(worst(["pass", "pass"])).toBe("pass");
    expect(worst(["pass", "warn"])).toBe("warn");
    expect(worst(["warn", "fail", "pass"])).toBe("fail");
    expect(worst([])).toBe("pass");
  });
  it("rollupChecks() counts by status and rolls up to the worst", () => {
    const r = rollupChecks([check("a", "A", "pass", ""), check("b", "B", "warn", ""), check("c", "C", "fail", "")]);
    expect(r).toMatchObject({ pass: 1, warn: 1, fail: 1, total: 3, status: "fail" });
  });
  it("distribution/avg/pct compute honestly", () => {
    expect(distribution(["x", "y", "x", null], (s) => s)).toEqual([["x", 2], ["y", 1]]);
    expect(avg([10, 20, 30])).toBe(20);
    expect(avg([])).toBeNull();
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 0)).toBe(0);
  });
});

describe("launch metrics", () => {
  it("computes all five sections and never fabricates untracked metrics", async () => {
    const m = await launchMetrics();
    expect(m.acquisition.discovered).toBeGreaterThan(0);
    expect(m.acquisition.leadSourceDistribution.length).toBeGreaterThan(0);
    // Genuinely uninstrumented metrics must be null, not a made-up number.
    expect(m.outreach.videoViews).toBeNull();
    expect(m.commercial.monthlyRecurringRevenue).toBeNull();
    expect(m.discovery.avgCallDurationMinutes).toBeNull();
    expect(m.discovery.confirmedFrictionPoints).toBeNull();
    // Intelligence-quality honesty surface is always present.
    expect(m.intelligenceQuality.instrumentationPending.length).toBeGreaterThan(0);
    // Follow-up completion is a percentage.
    expect(m.outreach.followUpCompletion).toBeGreaterThanOrEqual(0);
    expect(m.outreach.followUpCompletion).toBeLessThanOrEqual(100);
  });
});

describe("platform health", () => {
  it("returns a coherent snapshot with bounded rates", async () => {
    const h = await platformHealth();
    expect(["pass", "warn", "fail"]).toContain(h.status);
    expect(h.failureRate).toBeGreaterThanOrEqual(0);
    expect(h.failureRate).toBeLessThanOrEqual(100);
    expect(h.intelligenceProviders.ready).toBeGreaterThanOrEqual(1);
  });
});

describe("readiness checklist", () => {
  it("exercises the real BI engine and passes on seeded businesses", async () => {
    const r = await readinessChecklist({ manualReviewConfirmed: true });
    const bi = r.sections.find((s) => s.name === "Business Intelligence")!;
    expect(bi.checks.every((c) => c.status === "pass")).toBe(true);
    const commercial = r.sections.find((s) => s.name === "Commercial")!;
    expect(commercial.checks.some((c) => c.status === "fail")).toBe(false);
  });

  it("blocks on the human sign-off until confirmed", async () => {
    const unconfirmed = await readinessChecklist({ manualReviewConfirmed: false });
    const manual = unconfirmed.sections.find((s) => s.name === "Manual Review")!;
    expect(manual.checks[0].status).toBe("fail");
    expect(unconfirmed.ready).toBe(false);

    const confirmed = await readinessChecklist({ manualReviewConfirmed: true });
    expect(confirmed.sections.find((s) => s.name === "Manual Review")!.checks[0].status).toBe("pass");
  });
});

describe("launch validation", () => {
  it("is NOT READY without the sign-off and clears it with confirmation", async () => {
    const without = await runValidation({ manualReviewConfirmed: false });
    expect(without.recommendation).toBe("NOT READY");
    expect(without.blocking.length).toBeGreaterThan(0);

    const withConfirm = await runValidation({ manualReviewConfirmed: true });
    expect(withConfirm.recommendation).not.toBe("NOT READY");
    // Core engine/commercial/analytics categories must not be failing on seeded data.
    for (const name of ["Business Intelligence", "Commercial", "Analytics", "Approval"]) {
      expect(withConfirm.categories.find((c) => c.name === name)!.status).not.toBe("fail");
    }
  });
});

describe("launch confidence", () => {
  it("scores every dimension and matches the validation verdict", async () => {
    const validation = await runValidation({ manualReviewConfirmed: true });
    const c = await launchConfidence({ validation });
    expect(c.overallScore).toBeGreaterThanOrEqual(0);
    expect(c.overallScore).toBeLessThanOrEqual(100);
    const names = c.categories.map((x) => x.name);
    for (const n of ["Website", "Business Intelligence", "Provider Health", "Communication", "Discovery", "Commercial", "Analytics", "Testing", "Deployment", "Operational Readiness"]) {
      expect(names).toContain(n);
    }
    expect(c.recommendation).toBe(validation.blocking.length === 0 ? "READY TO LAUNCH" : "NOT READY");
  });
});

describe("first 100 + daily review", () => {
  it("first100 returns a bounded cohort with learning surfaces", async () => {
    const f = await firstHundred(100);
    expect(f.cohortSize).toBeLessThanOrEqual(100);
    expect(f.cohortSize).toBeGreaterThan(0);
    expect(f.progressPct).toBeGreaterThanOrEqual(0);
    expect(f.recommendationAccuracy).toBeNull();
    expect(Array.isArray(f.commonFriction)).toBe(true);
  });
  it("dailyReview produces an activity summary and text debrief", async () => {
    const d = await dailyReview();
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof d.summaryText).toBe("string");
    expect(d.summaryText.length).toBeGreaterThan(0);
    expect(d.suggestions.length).toBeGreaterThan(0);
    expect(d.instrumentationGaps.length).toBeGreaterThan(0);
  });
});
