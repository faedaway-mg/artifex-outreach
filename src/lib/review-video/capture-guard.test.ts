import { describe, it, expect } from "vitest";
import { assessCapture, wouldLeaveBottomBand } from "./capture-guard";

// Default frame is 1080×1920; evidence area height = 1920 * 0.95 = 1824px.
// Fit-to-width rendered height = 1080 * (surfaceHeight / surfaceWidth).
describe("capture-guard — the white-strip-at-bottom protection (Gate 6)", () => {
  it("a tall page fully fills the evidence area — safe to use as evidence, no band", () => {
    const a = assessCapture({ width: 1000, height: 2000 }); // rendered 2160 ≥ 1824
    expect(a.coversBottom).toBe(true);
    expect(a.bottomBandPx).toBe(0);
    expect(a.coverage).toBe(1);
    expect(a.recommendation).toBe("use-as-evidence");
    expect(wouldLeaveBottomBand({ width: 1000, height: 2000 })).toBe(false);
  });

  it("a surface that renders exactly to the evidence height covers with no band", () => {
    const a = assessCapture({ width: 1000, height: 1689 }); // rendered ≈ 1824.1 ≥ 1824
    expect(a.coversBottom).toBe(true);
    expect(a.bottomBandPx).toBe(0);
  });

  it("a slightly short page leaves a band → recommend atmospheric cover-crop (never fit-to-width)", () => {
    const surface = { width: 1000, height: 1520 }; // rendered ≈ 1641.6 → ~90% of 1824
    const a = assessCapture(surface);
    expect(a.coversBottom).toBe(false);
    expect(a.bottomBandPx).toBeGreaterThan(0);
    expect(a.coverage).toBeCloseTo(0.9, 1);
    expect(a.recommendation).toBe("atmospheric-only");
    expect(wouldLeaveBottomBand(surface)).toBe(true);
  });

  it("a very short, wide page cannot be filled cleanly → CAPTURE_BLOCKED (do not emit)", () => {
    const a = assessCapture({ width: 1600, height: 900 }); // rendered ≈ 607.5 → ~33%
    expect(a.coversBottom).toBe(false);
    expect(a.recommendation).toBe("capture-blocked");
    expect(a.reason).toMatch(/CAPTURE_BLOCKED|too short/i);
  });

  it("a zero/empty capture is blocked, never used", () => {
    expect(assessCapture({ width: 0, height: 0 }).recommendation).toBe("capture-blocked");
    expect(assessCapture({ width: 800, height: 0 }).coversBottom).toBe(false);
  });

  it("thresholds are tunable (a stricter evidence fraction shrinks the safe zone)", () => {
    const surface = { width: 1000, height: 1700 }; // rendered 1836
    expect(assessCapture(surface).coversBottom).toBe(true); // vs 1824 default
    expect(assessCapture(surface, { evidenceHeightFraction: 1.0 }).coversBottom).toBe(false); // vs 1920
  });
});
