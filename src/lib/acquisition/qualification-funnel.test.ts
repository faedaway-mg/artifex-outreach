import { describe, it, expect } from "vitest";
import { qualifyThroughFunnel, type FunnelCandidate } from "./qualification-funnel";
import { icpFit, isChainOrFranchise } from "./icp";
import type { CounterTestRunner } from "../problem-reality/runner";
import type { CounterTestExecution, ProblemRealityStatus } from "../problem-reality/types";

const runnerReturning = (verdict: ProblemRealityStatus, executed = true): CounterTestRunner => ({
  kind: "inline",
  run: async (h): Promise<CounterTestExecution> => ({
    hypothesisId: h.id, claim: h.claim, url: h.url, executed,
    startedAt: "", finishedAt: "", pagesVisited: [h.url], actionsAttempted: [], statesObserved: [],
    alternatePathsFound: [], nonDisruptive: true, verdict, rationale: `verdict ${verdict}`, evidenceShots: [],
  }),
});

const cand = (over: Partial<FunnelCandidate> = {}): FunnelCandidate => ({
  id: "c1", businessName: "Greenville Family Dental", industry: "Dental practice",
  city: "Greenville", state: "SC", website: "https://example.com", ...over,
});

describe("ICP", () => {
  it("flags chains/franchises/multi-location", () => {
    expect(isChainOrFranchise({ businessName: "Liberty Tax" })).toBe(true);
    expect(isChainOrFranchise({ businessName: "Center MedSpa", locationsCount: 7 })).toBe(true);
    expect(isChainOrFranchise({ businessName: "Liberty Tax", normalizedName: "liberty tax #18369" })).toBe(true);
    expect(isChainOrFranchise({ businessName: "Larimar Medspa" })).toBe(false);
  });
  it("icpFit rejects chains", () => {
    expect(icpFit({ businessName: "H&R Block" }).fit).toBe(false);
    expect(icpFit({ businessName: "Larimar Medspa" }).fit).toBe(true);
  });
});

describe("qualification funnel — order + gates", () => {
  it("rejects wrong geography before any counter-test", async () => {
    const r = await qualifyThroughFunnel(cand({ city: "Los Angeles", state: "CA" }), runnerReturning("PROVEN"));
    expect(r).toMatchObject({ decision: "reject", stageReached: "geo", category: "wrong-geography" });
  });
  it("rejects wrong ICP before any counter-test", async () => {
    const r = await qualifyThroughFunnel(cand({ businessName: "Liberty Tax", city: "Fayetteville", state: "AR" }), runnerReturning("PROVEN"));
    expect(r).toMatchObject({ decision: "reject", stageReached: "icp", category: "wrong-icp" });
  });
  it("rejects closed businesses", async () => {
    const r = await qualifyThroughFunnel(cand({ businessStatus: "CLOSED_PERMANENTLY" }), runnerReturning("PROVEN"));
    expect(r).toMatchObject({ decision: "reject", stageReached: "closed", category: "closed" });
  });
  it("rejects no-website (not browser-testable here)", async () => {
    const r = await qualifyThroughFunnel(cand({ website: null }), runnerReturning("PROVEN"));
    expect(r).toMatchObject({ decision: "reject", stageReached: "no-website", category: "unreachable" });
  });

  it("PROMOTES only on a real PROVEN execution", async () => {
    const r = await qualifyThroughFunnel(cand(), runnerReturning("PROVEN"));
    expect(r.decision).toBe("promote");
    expect(r.problemReality?.basis).toBe("live-counter-test");
  });
  it("DISPROVEN ⇒ reject (never downgraded)", async () => {
    const r = await qualifyThroughFunnel(cand(), runnerReturning("DISPROVEN"));
    expect(r).toMatchObject({ decision: "reject", stageReached: "counter-test", category: "problem-disproven" });
  });
  it("NO_MATERIAL_PROBLEM ⇒ reject", async () => {
    const r = await qualifyThroughFunnel(cand(), runnerReturning("NO_MATERIAL_PROBLEM"));
    expect(r.category).toBe("no-material-problem");
  });
  it("PLANNED (not executed) never promotes even if verdict says PROVEN", async () => {
    const r = await qualifyThroughFunnel(cand(), runnerReturning("PROVEN", false));
    expect(r.decision).toBe("reject");
  });
});
