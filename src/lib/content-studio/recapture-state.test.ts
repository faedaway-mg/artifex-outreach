import { describe, it, expect } from "vitest";
import {
  decideOutcome, foldRecaptureStates, isRecaptureDue, nextRecaptureAt, recaptureBackoffMs,
  isTerminalOutcome, MAX_RECAPTURE_ATTEMPTS, RECAPTURE_ACTION, type RecaptureAttemptRecord,
} from "./recapture-state";

const now = new Date("2026-09-04T12:00:00Z");
function auditRow(rec: RecaptureAttemptRecord) {
  return { action: RECAPTURE_ACTION, meta: { rec }, createdAt: rec.at };
}

describe("bounded recapture state machine — decideOutcome", () => {
  it("success → VOICEOVER_READY (terminal, no next attempt)", () => {
    const d = decideOutcome({ attempt: 1, succeeded: true, now });
    expect(d.outcome).toBe("VOICEOVER_READY");
    expect(d.nextAttemptAt).toBeNull();
    expect(isTerminalOutcome(d.outcome)).toBe(true);
  });

  it("recoverable failure below the cap → RETRY_SCHEDULED with a concrete next-attempt time", () => {
    const d = decideOutcome({ attempt: 1, succeeded: false, now });
    expect(d.outcome).toBe("RETRY_SCHEDULED");
    expect(d.nextAttemptAt).toBe(nextRecaptureAt(now, 1));
    expect(isTerminalOutcome(d.outcome)).toBe(false);
  });

  it("failure at the cap → AUTOMATICALLY_EXCLUDED (terminal)", () => {
    const d = decideOutcome({ attempt: MAX_RECAPTURE_ATTEMPTS, succeeded: false, now });
    expect(d.outcome).toBe("AUTOMATICALLY_EXCLUDED");
    expect(d.nextAttemptAt).toBeNull();
  });

  it("a genuine human-only condition at the cap → NEEDS_ATTENTION", () => {
    const d = decideOutcome({ attempt: MAX_RECAPTURE_ATTEMPTS, succeeded: false, humanOnly: true, now });
    expect(d.outcome).toBe("NEEDS_ATTENTION");
  });

  it("backoff grows with attempts", () => {
    expect(recaptureBackoffMs(1)).toBeLessThan(recaptureBackoffMs(2));
    expect(recaptureBackoffMs(2)).toBeLessThan(recaptureBackoffMs(3));
  });
});

describe("recapture state — fold + due", () => {
  it("latest record wins and attempts count up", () => {
    const audit = [
      auditRow({ leadId: "L1", attempt: 2, at: "2026-09-03T00:00:00Z", outcome: "RETRY_SCHEDULED", reason: "narration:too_short", nextAttemptAt: "2026-09-04T00:00:00Z" }),
      auditRow({ leadId: "L1", attempt: 1, at: "2026-09-02T00:00:00Z", outcome: "RETRY_SCHEDULED", reason: "no-finding", nextAttemptAt: "2026-09-03T00:00:00Z" }),
    ]; // recent-first, as listAudit returns
    const states = foldRecaptureStates(audit);
    const s = states.get("L1")!;
    expect(s.attempts).toBe(2);
    expect(s.lastReason).toBe("narration:too_short");
    expect(s.nextAttemptAt).toBe("2026-09-04T00:00:00Z");
  });

  it("a terminal state is never due; a future retry is not due; a past retry IS due", () => {
    const terminal = foldRecaptureStates([auditRow({ leadId: "A", attempt: 1, at: now.toISOString(), outcome: "VOICEOVER_READY", reason: "ok", nextAttemptAt: null })]).get("A");
    expect(isRecaptureDue(terminal, now)).toBe(false);

    const future = foldRecaptureStates([auditRow({ leadId: "B", attempt: 1, at: now.toISOString(), outcome: "RETRY_SCHEDULED", reason: "x", nextAttemptAt: "2026-09-05T00:00:00Z" })]).get("B");
    expect(isRecaptureDue(future, now)).toBe(false);

    const past = foldRecaptureStates([auditRow({ leadId: "C", attempt: 1, at: "2026-09-01T00:00:00Z", outcome: "RETRY_SCHEDULED", reason: "x", nextAttemptAt: "2026-09-02T00:00:00Z" })]).get("C");
    expect(isRecaptureDue(past, now)).toBe(true);

    // a lead never attempted is due
    expect(isRecaptureDue(undefined, now)).toBe(true);
  });

  it("a lead that already hit max attempts is not due", () => {
    const maxed = foldRecaptureStates([auditRow({ leadId: "D", attempt: MAX_RECAPTURE_ATTEMPTS, at: now.toISOString(), outcome: "AUTOMATICALLY_EXCLUDED", reason: "exhausted", nextAttemptAt: null })]).get("D");
    expect(isRecaptureDue(maxed, now)).toBe(false);
  });
});
