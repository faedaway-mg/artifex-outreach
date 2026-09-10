import { describe, it, expect, afterEach } from "vitest";
import {
  evaluateRamp,
  laneRampStatus,
  combinedRampCapacity,
  RAMP_LEVEL_CAPS,
  MAX_AUTONOMOUS_LEVEL,
  type LaneDeliverabilitySignals,
} from "./ramp";

const healthy = (over: Partial<LaneDeliverabilitySignals> = {}): LaneDeliverabilitySignals => ({
  transportHealthy: true,
  authHealthy: true,
  gmailSeed: "inbox",
  outlookSeed: "inbox",
  bounceRate: 0.005,
  spamComplaintRate: 0.0,
  sentInWindow: 40,
  ...over,
});

describe("ramp effective capacity", () => {
  afterEach(() => {
    delete process.env.GOOGLE_SENDER_1_DAILY_CAP;
    delete process.env.GOOGLE_SENDER_1_ENABLED;
  });

  it("effective cap = min(level cap, configured lane cap)", () => {
    process.env.GOOGLE_SENDER_1_DAILY_CAP = "8";
    // Level 1 = 2/day, under the configured 8 → 2
    expect(laneRampStatus({ laneId: "sender-1", state: "WARMING", level: 1 }).effectiveDailyCap).toBe(2);
    // Level 4 = 8/day, equals configured 8 → 8
    expect(laneRampStatus({ laneId: "sender-1", state: "ESTABLISHED", level: 4 }).effectiveDailyCap).toBe(8);
  });

  it("never exceeds the configured lane cap even at a higher level", () => {
    process.env.GOOGLE_SENDER_1_DAILY_CAP = "8";
    // Level 5 = 12, but configured cap is 8 → clamped to 8 (underlying max never raised)
    expect(laneRampStatus({ laneId: "sender-1", state: "ESTABLISHED", level: 5 }).effectiveDailyCap).toBe(8);
  });

  it("is 0 when paused or disabled", () => {
    process.env.GOOGLE_SENDER_1_DAILY_CAP = "8";
    expect(laneRampStatus({ laneId: "sender-1", state: "PAUSED", level: 4 }).effectiveDailyCap).toBe(0);
    process.env.GOOGLE_SENDER_1_ENABLED = "0";
    expect(laneRampStatus({ laneId: "sender-1", state: "RAMPING", level: 4 }).effectiveDailyCap).toBe(0);
  });

  it("combined capacity is the SUM of each lane's own cap (no quota transfer)", () => {
    const a = laneRampStatus({ laneId: "sender-1", state: "RAMPING", level: 2 }); // 4
    const b = laneRampStatus({ laneId: "sender-2", state: "WARMING", level: 1 }); // 2
    expect(combinedRampCapacity([a, b])).toBe(a.effectiveDailyCap + b.effectiveDailyCap);
  });
});

describe("ramp promotion is earned, not calendar-based (§30)", () => {
  it("promotes on healthy signals + real sample + Gmail & Outlook inbox", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 1 }, healthy());
    expect(e.decision).toBe("promote");
    expect(e.to.level).toBe(2);
  });

  it("does NOT promote if Outlook is still Junk (preserved observation §29)", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 2 }, healthy({ outlookSeed: "junk" }));
    expect(e.decision).toBe("demote"); // junk lowers a level
    expect(e.to.level).toBe(1);
  });

  it("does NOT promote on an untested Outlook mailbox (not_tested ≠ confirmation)", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 1 }, healthy({ outlookSeed: "not_tested" }));
    expect(e.decision).toBe("hold");
    expect(e.to.level).toBe(1);
    expect(e.reasons.some((r) => /Outlook/.test(r))).toBe(true);
  });

  it("does NOT promote without a sufficient real-send sample", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 1 }, healthy({ sentInWindow: 5 }));
    expect(e.decision).toBe("hold");
    expect(e.reasons.some((r) => /sample/i.test(r))).toBe(true);
  });

  it("stops autonomous promotion at Level 4 (8/lane) without operator approval", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "ESTABLISHED", level: MAX_AUTONOMOUS_LEVEL }, healthy());
    expect(e.decision).toBe("hold");
    expect(e.to.level).toBe(MAX_AUTONOMOUS_LEVEL);
    expect(e.reasons.some((r) => /operator approval/i.test(r))).toBe(true);
  });

  it("allows Level 4 → 5 only with explicit operator approval", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "ESTABLISHED", level: 4 }, healthy(), { operatorApprovedAboveL4: true });
    expect(e.decision).toBe("promote");
    expect(e.to.level).toBe(5);
    expect(RAMP_LEVEL_CAPS[5]).toBe(12);
  });
});

describe("ramp auto-safety", () => {
  it("pauses on unhealthy transport/auth", () => {
    expect(evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 3 }, healthy({ transportHealthy: false })).to.state).toBe("PAUSED");
    expect(evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 3 }, healthy({ authHealthy: false })).to.state).toBe("PAUSED");
  });

  it("pauses on high bounce or spam", () => {
    expect(evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 3 }, healthy({ bounceRate: 0.06 })).decision).toBe("pause");
    expect(evaluateRamp({ laneId: "sender-1", state: "RAMPING", level: 3 }, healthy({ spamComplaintRate: 0.01 })).decision).toBe("pause");
  });

  it("resumes conservatively at the same level once signals recover", () => {
    const e = evaluateRamp({ laneId: "sender-1", state: "PAUSED", level: 3 }, healthy());
    expect(e.decision).toBe("resume");
    expect(e.to.level).toBe(3); // no level jump on resume
    expect(e.to.state).toBe("RAMPING");
  });
});
