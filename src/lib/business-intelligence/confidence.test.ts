import { describe, it, expect } from "vitest";
import { confidence, scoreToLabel, aggregate, weakest, fromEvidence, fromEvidenceConfidence, CONFIDENCE_SCORE } from "./confidence";

describe("Confidence model", () => {
  it("maps every label to a stable score", () => {
    expect(confidence("Observed")).toEqual({ label: "Observed", score: CONFIDENCE_SCORE.Observed });
    expect(confidence("Unknown").score).toBe(0.15);
  });

  it("snaps aggregate scores to strength tiers, never to 'Reported'", () => {
    // 0.81 is nearest to Reported(0.7) numerically, but Reported is provenance,
    // not a tier — an aggregate must read as Observed/Likely/Inferred/Unknown.
    expect(scoreToLabel(0.81)).toBe("Observed");
    expect(scoreToLabel(0.6)).toBe("Likely");
    expect(scoreToLabel(0.4)).toBe("Inferred");
    expect(scoreToLabel(0.15)).toBe("Unknown");
  });

  it("aggregates by mean and stays on the scale", () => {
    const a = aggregate([confidence("Observed"), confidence("Likely")]);
    expect(a.score).toBeCloseTo((0.95 + 0.6) / 2, 3);
    expect(["Observed", "Likely"]).toContain(a.label);
  });

  it("aggregate of nothing is Unknown, never a fabricated certainty", () => {
    expect(aggregate([]).label).toBe("Unknown");
  });

  it("weakest returns the most cautious confidence", () => {
    expect(weakest([confidence("Observed"), confidence("Inferred"), confidence("Likely")]).label).toBe("Inferred");
  });

  it("maps normalized evidence onto the scale", () => {
    expect(fromEvidence("Directly observed fact", "Verified").label).toBe("Observed");
    expect(fromEvidence("Strong inference", "Likely").label).toBe("Likely");
    expect(fromEvidence("Possible opportunity", "Unknown").label).toBe("Inferred");
    expect(fromEvidence("Open discovery question", "Unknown").label).toBe("Unknown");
    expect(fromEvidenceConfidence("Verified").label).toBe("Observed");
  });
});
