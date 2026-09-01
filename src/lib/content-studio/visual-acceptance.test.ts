import { describe, it, expect } from "vitest";
import { diff, luma, judge } from "../../../scripts/cs-visual-acceptance.mjs";

describe("visual-acceptance pure helpers", () => {
  it("diff is 0 for identical signatures and grows with divergence", () => {
    const a = Buffer.from([255, 0, 255, 0, 255, 0]);
    expect(diff(a, a)).toBe(0);
    const b = Buffer.from([0, 255, 0, 255, 0, 255]);
    expect(diff(a, b)).toBeGreaterThan(200);
  });

  it("luma ranks bright above dark", () => {
    expect(luma(Buffer.from([255, 255, 255]))).toBeGreaterThan(luma(Buffer.from([10, 10, 10])));
  });

  it("PASSES when the evidence frame matches the screenshot and clearly beats the control", () => {
    const v = judge({ dEvidence: 3.45, dControl: 129.9, evLuma: 135, vignetteRatio: 1.02 });
    expect(v.ok).toBe(true);
    expect(v.checks).toMatchObject({ matchesScreenshot: true, beatsControl: true, notDark: true, noVignette: true, inSafeArea: true });
  });

  it("FAILS a job whose screenshot only appears in the poster/first frame (evidence frame doesn't match)", () => {
    const v = judge({ dEvidence: 128, dControl: 130, evLuma: 20, vignetteRatio: 1.0 });
    expect(v.ok).toBe(false);
    expect(v.checks.matchesScreenshot).toBe(false);
    expect(v.checks.beatsControl).toBe(false);
  });

  it("FAILS when a vignette/scrim darkens the evidence screenshot's edges", () => {
    const v = judge({ dEvidence: 5, dControl: 120, evLuma: 130, vignetteRatio: 0.6 });
    expect(v.ok).toBe(false);
    expect(v.checks.noVignette).toBe(false);
  });
});
