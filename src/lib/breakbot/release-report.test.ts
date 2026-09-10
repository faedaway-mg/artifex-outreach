import { describe, it, expect } from "vitest";
import { assembleReleaseReport, classifyRepair, renderReleaseReport, type SuiteResult, type ReleaseReportInput } from "./release-report";

function suite(name: string, status: SuiteResult["status"], gating = true, blockerDetails: string[] = []): SuiteResult {
  return { name, status, gating, blockers: blockerDetails.length, warnings: status === "WARNING" ? 1 : 0, detail: `${name} ${status}`, blockerDetails };
}

const base: Omit<ReleaseReportInput, "suites"> = {
  candidateSha: "abc1234",
  explainerCoverage: { healthy: 9, total: 9, missing: [], broken: [], affectsJourneys: true },
  escapedDefects: { total: 7, pendingDeploy: 2 },
  repairs: [],
  generatedAt: "2026-09-10T00:00:00Z",
};

describe("release report — verdict", () => {
  it("READY when every gating suite passes and coverage is complete", () => {
    const r = assembleReleaseReport({ ...base, suites: [suite("regression", "PASS"), suite("media", "PASS"), suite("visual", "PASS"), suite("invariants", "PASS")] });
    expect(r.verdict).toBe("READY_TO_DEPLOY");
    expect(r.blockers).toHaveLength(0);
  });

  it("BLOCKED when any gating suite is BLOCKED", () => {
    const r = assembleReleaseReport({ ...base, suites: [suite("regression", "PASS"), suite("media", "BLOCKED", true, ["cta-conversion:media.blankTimeline visuals blank after 5%"])] });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blockers.some((b) => b.includes("media.blankTimeline"))).toBe(true);
  });

  it("a gating BLOCKED suite blocks even when it enumerated no specific lines", () => {
    // The visual harness reports BLOCKED with an empty detail list in some shapes; a
    // gating block must never be silently dropped just because details were empty.
    const r = assembleReleaseReport({ ...base, suites: [suite("visual", "BLOCKED", true, [])] });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it("WARNING suites never block", () => {
    const r = assembleReleaseReport({ ...base, suites: [suite("media", "WARNING")] });
    expect(r.verdict).toBe("READY_TO_DEPLOY");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("a non-gating BLOCKED suite warns but does not block", () => {
    const r = assembleReleaseReport({ ...base, suites: [suite("advisory", "BLOCKED", false, ["x"])] });
    expect(r.verdict).toBe("READY_TO_DEPLOY");
    expect(r.warnings.some((w) => w.includes("non-gating"))).toBe(true);
  });

  it("a missing explainer that affects journeys BLOCKS the release (§9)", () => {
    const r = assembleReleaseReport({
      ...base,
      suites: [suite("regression", "PASS")],
      explainerCoverage: { healthy: 8, total: 9, missing: ["accessibility"], broken: [], affectsJourneys: true },
    });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blockers.some((b) => b.includes("accessibility"))).toBe(true);
  });

  it("a missing explainer that does NOT affect journeys only warns", () => {
    const r = assembleReleaseReport({
      ...base,
      suites: [suite("regression", "PASS")],
      explainerCoverage: { healthy: 8, total: 9, missing: ["homepage-sprint"], broken: [], affectsJourneys: false },
    });
    expect(r.verdict).toBe("READY_TO_DEPLOY");
    expect(r.warnings.some((w) => w.includes("homepage-sprint"))).toBe(true);
  });
});

describe("bounded repair classification (§16–§19)", () => {
  it("proposes a SAFE reuse-visual-master repair for a blank explainer (no re-render, no TTS)", () => {
    const rp = classifyRepair("trust-explainer", "media.blankTimeline", "cta-conversion");
    expect(rp).not.toBeNull();
    expect(rp!.kind).toBe("auto-orchestrable");
    expect(rp!.note.toLowerCase()).toContain("do not regenerate tts");
    expect(rp!.action.toLowerCase()).toContain("no elevenlabs");
  });

  it("returns null (escalate) for an unknown finding kind", () => {
    expect(classifyRepair("x", "some.unknownKind", "y")).toBeNull();
  });
});

describe("render", () => {
  it("renders a verdict banner and lists blockers", () => {
    const r = assembleReleaseReport({ ...base, suites: [suite("media", "BLOCKED", true, ["cta:media.blankTimeline"])] });
    const text = renderReleaseReport(r);
    expect(text).toContain("RELEASE READINESS REPORT");
    expect(text).toContain("BLOCKED — deploy held");
    expect(text).toContain("media.blankTimeline");
  });
});
