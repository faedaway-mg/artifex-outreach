import { describe, it, expect } from "vitest";
import { assembleCockpit, type AssembleCockpitInput } from "./cockpit";
import { costLedgerView } from "./cost-ledger-store";

const NOW = "2026-09-10T12:00:00.000Z";

function baseInput(over: Partial<AssembleCockpitInput> = {}): AssembleCockpitInput {
  return {
    now: NOW,
    health: { status: "ok", alerts: [] },
    readiness: { state: "NO-GO", blockers: ["prospect-lanes"] },
    ramp: {
      lanes: [
        { laneId: "sender-1", state: "WARMING", level: 1, effectiveDailyCap: 2 } as any,
        { laneId: "sender-2", state: "WARMING", level: 1, effectiveDailyCap: 2 } as any,
      ],
      combinedDailyCapacity: 4,
      seed: { gmail: "not_tested", outlook: "junk" },
      outlookBlocksPromotion: true,
    },
    sprint: {
      discovered: 100, cheaplyQualified: 60, rankedPool: 40, rejectedBeforePaid: 40,
      avgSendValue: 62, finalists: [], finalistsMeetingContract: 0,
      readyToSendTarget: { min: 20, max: 40 }, excludedLegacy: 12,
    } as any,
    cost: costLedgerView([]),
    ...over,
  };
}

describe("operator cockpit assembler (§14)", () => {
  it("surfaces system health, launch GO/NO-GO, and lanes with seed + promotion block", () => {
    const v = assembleCockpit(baseInput());
    expect(v.systemHealth.status).toBe("ok");
    expect(v.launchReadiness.state).toBe("NO-GO");
    expect(v.launchReadiness.blockers).toContain("prospect-lanes");
    expect(v.launchReadiness.performsSend).toBe(false);
    expect(v.lanes).toHaveLength(2);
    expect(v.lanes[0].seed.outlook).toBe("junk");
    expect(v.lanes[0].blocksPromotion).toBe(true);
    expect(v.combinedDailyCapacity).toBe(4);
  });

  it("surfaces the Lead Sprint funnel incl. legacy-excluded count", () => {
    const v = assembleCockpit(baseInput());
    expect(v.leadSprint.discovered).toBe(100);
    expect(v.leadSprint.rankedPool).toBe(40);
    expect(v.leadSprint.finalists).toBe(0);
    expect(v.leadSprint.excludedLegacy).toBe(12);
    expect(v.leadSprint.readyToSendTarget).toEqual({ min: 20, max: 40 });
  });

  it("safety posture defaults to delivery OFF / autosend OFF, Google prospect + Resend transactional", () => {
    const v = assembleCockpit(baseInput());
    expect(v.safety.prospectDeliveryOn).toBe(false);
    expect(v.safety.autosendOn).toBe(false);
    expect(v.safety.prospectTransport).toBe("google-workspace");
    expect(v.safety.transactionalTransport).toBe("resend");
  });

  it("outcomes are null (honestly unavailable) until real sends occur — never fabricated", () => {
    const v = assembleCockpit(baseInput());
    expect(v.outcomes.sent).toBeNull();
    expect(v.outcomes.replies).toBeNull();
    expect(v.outcomes.purchases).toBeNull();
  });

  it("production counts default to zero until the gated paid pipeline runs", () => {
    const v = assembleCockpit(baseInput());
    expect(v.production).toEqual({ voiceovers: 0, renders: 0, breakbotFailures: 0, replacementCandidates: 0 });
  });
});
