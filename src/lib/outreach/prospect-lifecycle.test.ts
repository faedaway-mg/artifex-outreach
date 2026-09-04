import { describe, it, expect } from "vitest";
import { resolveProspectState, voiceoverPrereqsMissing, type LifecycleSignals } from "./prospect-lifecycle";

// A fully operator-ready video prospect (all prerequisites present, awaiting only the voiceover).
function ready(over: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    internal: false, terminalStage: false, suppressed: false, contacted: false, sent: false,
    scheduledFuture: false, eligible: true, recaptureExcluded: false,
    hasTemplate: true, hasFinding: true, hasScreenshot: true, narrationPass: true, frozenPdf: true,
    emailSubject: true, emailBody: true, draftPackageState: "INCOMPLETE",
    uploadPresent: false, renderActive: false, renderReadyVerified: false, renderFailed: false,
    renderAttempts: 0, packageVideoBound: false, maxRenderAttempts: 3, ...over,
  };
}

describe("resolveProspectState — canonical lifecycle (one prospect, one state)", () => {
  it("all prerequisites present + no upload → NEEDS_VOICEOVER", () => {
    expect(resolveProspectState(ready()).state).toBe("NEEDS_VOICEOVER");
  });

  it("upload + active render → RENDERING (never counted as voiceover-ready)", () => {
    const v = resolveProspectState(ready({ uploadPresent: true, renderActive: true }));
    expect(v.state).toBe("RENDERING");
    expect(v.state).not.toBe("NEEDS_VOICEOVER");
  });

  it("a prospect missing email body or frozen PDF CANNOT be NEEDS_VOICEOVER (→ PREPARING)", () => {
    expect(resolveProspectState(ready({ emailBody: false })).state).toBe("PREPARING_AUTOMATICALLY");
    expect(resolveProspectState(ready({ frozenPdf: false })).state).toBe("PREPARING_AUTOMATICALLY");
    expect(voiceoverPrereqsMissing(ready({ emailBody: false, frozenPdf: false }))).toEqual(expect.arrayContaining(["emailBody", "frozenPDF"]));
  });

  it("verified render not yet bound to the package → AUTOMATIC_REPAIR (the Motion bug)", () => {
    const v = resolveProspectState(ready({ uploadPresent: true, renderReadyVerified: true, packageVideoBound: false }));
    expect(v.state).toBe("AUTOMATIC_REPAIR");
    expect(v.reason).toMatch(/not yet assembled/i);
  });

  it("verified render bound + complete package → READY_TO_APPROVE", () => {
    const v = resolveProspectState(ready({ uploadPresent: true, renderReadyVerified: true, packageVideoBound: true, draftPackageState: "READY_TO_APPROVE" }));
    expect(v.state).toBe("READY_TO_APPROVE");
  });

  it("contacted company with a completed video → NEEDS_ATTENTION (lineage preserved, never auto-sent)", () => {
    const v = resolveProspectState(ready({ contacted: true, uploadPresent: true, renderReadyVerified: true, packageVideoBound: true }));
    expect(v.state).toBe("NEEDS_ATTENTION");
    expect(v.reason).toMatch(/already contacted/i);
  });

  it("email-only scheduled send (no video) → SCHEDULED", () => {
    const v = resolveProspectState(ready({ scheduledFuture: true, hasTemplate: false, draftPackageState: "INCOMPLETE" }));
    expect(v.state).toBe("SCHEDULED");
  });

  it("failed render → bounded AUTOMATIC_REPAIR, then NEEDS_ATTENTION at max attempts", () => {
    expect(resolveProspectState(ready({ uploadPresent: true, renderFailed: true, renderAttempts: 1 })).state).toBe("AUTOMATIC_REPAIR");
    expect(resolveProspectState(ready({ uploadPresent: true, renderFailed: true, renderAttempts: 3 })).state).toBe("NEEDS_ATTENTION");
  });

  it("upload with no render job → AUTOMATIC_REPAIR (enqueue)", () => {
    expect(resolveProspectState(ready({ uploadPresent: true })).state).toBe("AUTOMATIC_REPAIR");
  });

  it("suppressed / terminal → AUTOMATICALLY_EXCLUDED; sent (no video) → SENT", () => {
    expect(resolveProspectState(ready({ suppressed: true })).state).toBe("AUTOMATICALLY_EXCLUDED");
    expect(resolveProspectState(ready({ terminalStage: true })).state).toBe("AUTOMATICALLY_EXCLUDED");
    expect(resolveProspectState(ready({ sent: true, hasTemplate: false, draftPackageState: null })).state).toBe("SENT");
  });

  it("exactly one state for every fixture (exhaustive determinism)", () => {
    const fixtures = [ready(), ready({ uploadPresent: true, renderActive: true }), ready({ emailBody: false }),
      ready({ uploadPresent: true, renderReadyVerified: true }), ready({ scheduledFuture: true, hasTemplate: false }),
      ready({ contacted: true, renderReadyVerified: true, packageVideoBound: true }), ready({ suppressed: true })];
    for (const f of fixtures) {
      const v = resolveProspectState(f);
      expect(typeof v.state).toBe("string");
      expect(v.state.length).toBeGreaterThan(0);
    }
  });
});
