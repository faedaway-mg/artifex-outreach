import { describe, it, expect } from "vitest";
import { deriveCallLeadState, type CallStateLead } from "./call-state";

const base: CallStateLead = {
  pipelineStage: "Qualified",
  businessStatus: "OPERATIONAL",
  nextFollowUpAt: null,
  note: null,
};

describe("deriveCallLeadState — one lead, one active contact state", () => {
  it("a fresh call-first lead needs the call made", () => {
    expect(deriveCallLeadState(base).kind).toBe("call-required");
  });

  it("a scheduled next attempt (no-answer / voicemail / follow-up) becomes attempt-scheduled, not call-required", () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const s = deriveCallLeadState({ ...base, nextFollowUpAt: at, note: "[2026-07-28] Call: no answer." });
    expect(s.kind).toBe("attempt-scheduled");
    if (s.kind === "attempt-scheduled") {
      expect(s.at).toBe(at);
      expect(s.lastResult).toContain("no answer");
    }
  });

  it("a Lost lead is closed as not-interested — never shows 'Call the business'", () => {
    const s = deriveCallLeadState({ ...base, pipelineStage: "Lost" });
    expect(s.kind).toBe("closed");
    if (s.kind === "closed") expect(s.reason).toBe("not-interested");
  });

  it("a Disqualified lead is closed as invalid", () => {
    const s = deriveCallLeadState({ ...base, pipelineStage: "Disqualified" });
    expect(s).toMatchObject({ kind: "closed", reason: "invalid" });
  });

  it("a closed business status is closed as invalid even before the stage changes", () => {
    const s = deriveCallLeadState({ ...base, businessStatus: "CLOSED_PERMANENTLY" });
    expect(s).toMatchObject({ kind: "closed", reason: "invalid" });
  });

  it("closed takes precedence over a stale scheduled follow-up", () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    expect(deriveCallLeadState({ ...base, pipelineStage: "Lost", nextFollowUpAt: at }).kind).toBe("closed");
  });
});
