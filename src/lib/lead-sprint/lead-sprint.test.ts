import { describe, it, expect, afterEach } from "vitest";
import { podForLocation, isPriorityPod, MARKET_PODS } from "./pods";
import { scoreSendValue, type SendValueInput } from "./send-value";
import { scoreProductionConfidence, type ProductionConfidenceInput } from "./production-confidence";
import {
  paidComputeEnabled,
  assertPaidComputeAllowed,
  PaidComputeGateError,
  recordCost,
  summarizeCostLedger,
} from "./cost-gate";
import { canEnterPaid, isFreeState, isPaidState } from "./states";
import { runLeadSprint, finalistBufferSize, type SprintCandidate } from "./engine";

// ── Market pods (§4) ────────────────────────────────────────────────────────
describe("market pods", () => {
  it("classifies the four initial priority pods by cluster city", () => {
    expect(podForLocation("Greenville", "SC").priority).toBe("priority");
    expect(podForLocation("Huntsville", "AL").priority).toBe("priority");
    expect(podForLocation("Chattanooga", "TN").priority).toBe("priority");
    expect(podForLocation("Bentonville", "AR").priority).toBe("priority");
    expect(isPriorityPod("Rogers", "AR")).toBe(true); // NW Arkansas satellite
  });

  it("treats the Chattanooga metro's North Georgia towns as the same pod", () => {
    const m = podForLocation("Ringgold", "GA");
    expect(m.pod?.id).toBe("chattanooga-tn");
    expect(m.priority).toBe("priority");
  });

  it("state-level fallback inside a pod state is expansion, not priority", () => {
    const m = podForLocation("Mobile", "AL"); // in AL but not a Huntsville cluster town
    expect(m.priority).toBe("expansion");
    expect(m.pod?.id).toBe("huntsville-al");
  });

  it("returns none for a location outside every pod", () => {
    expect(podForLocation("Portland", "OR").priority).toBe("none");
  });

  it("all pods carry the states their clusters reference", () => {
    for (const pod of MARKET_PODS) expect(pod.states.length).toBeGreaterThan(0);
  });
});

// ── Send Value scoring (§4) ──────────────────────────────────────────────────
const baseSV = (over: Partial<SendValueInput> = {}): SendValueInput => ({
  leadId: "L1",
  reputationStrength: 12,
  digitalReputationGap: 20,
  decisionMakerAccess: 8,
  customerValue: 8,
  marketFit: 10,
  websiteOpportunity: 16,
  abilityToPay: 12,
  contactability: 8,
  podPriority: "priority",
  ...over,
});

describe("send value score", () => {
  it("is deterministic and bounded 0..100", () => {
    const a = scoreSendValue(baseSV());
    const b = scoreSendValue(baseSV());
    expect(a.total).toBe(b.total);
    expect(a.total).toBeGreaterThan(0);
    expect(a.total).toBeLessThanOrEqual(100);
  });

  it("weights digital pain heaviest (the persona thesis)", () => {
    const high = scoreSendValue(baseSV({ digitalReputationGap: 25 }));
    const low = scoreSendValue(baseSV({ digitalReputationGap: 0, websiteOpportunity: 0 }));
    expect(high.breakdown.digitalPain).toBeGreaterThan(low.breakdown.digitalPain);
    expect(high.total).toBeGreaterThan(low.total);
    // digital pain axis ceiling (25) exceeds every other axis ceiling (≤20)
    expect(high.breakdown.digitalPain).toBeGreaterThanOrEqual(high.breakdown.market);
  });

  it("gives a priority-pod focus bonus over a non-pod lead", () => {
    const inPod = scoreSendValue(baseSV({ podPriority: "priority" }));
    const noPod = scoreSendValue(baseSV({ podPriority: "none" }));
    expect(inPod.breakdown.market).toBeGreaterThan(noPod.breakdown.market);
  });

  it("bands HIGH/MEDIUM/LOW by total", () => {
    expect(scoreSendValue(baseSV()).band).toBe("HIGH");
    const weak = scoreSendValue(baseSV({ reputationStrength: 2, digitalReputationGap: 2, websiteOpportunity: 2, abilityToPay: 2, customerValue: 1, contactability: 1, decisionMakerAccess: 1, marketFit: 2, podPriority: "none" }));
    expect(weak.band).toBe("LOW");
  });
});

// ── Production Confidence (§6, §32) ──────────────────────────────────────────
const basePC = (over: Partial<ProductionConfidenceInput> = {}): ProductionConfidenceInput => ({
  leadId: "L1",
  notTerminal: true,
  quickFixEligible: true,
  materialEvidence: true,
  reachableContact: true,
  clearsMarginGate: true,
  voiceGenerationResolved: true,
  compatibleTrustAvailable: true,
  personaFit: true,
  evidenceSpecificity: 12,
  ...over,
});

describe("production confidence", () => {
  it("meets the minimum contract when all hard prerequisites pass", () => {
    const pc = scoreProductionConfidence(basePC());
    expect(pc.meetsMinimumContract).toBe(true);
    expect(pc.band).not.toBe("BLOCKED");
    expect(pc.total).toBeGreaterThan(0);
  });

  it("BLOCKS (contract unmet, total 0) when any hard prerequisite fails", () => {
    for (const key of ["notTerminal", "quickFixEligible", "materialEvidence", "reachableContact", "clearsMarginGate", "voiceGenerationResolved", "compatibleTrustAvailable"] as const) {
      const pc = scoreProductionConfidence(basePC({ [key]: false }));
      expect(pc.meetsMinimumContract).toBe(false);
      expect(pc.band).toBe("BLOCKED");
      expect(pc.total).toBe(0);
      expect(pc.blockers.length).toBeGreaterThan(0);
    }
  });

  it("transcript-only trust is never sufficient (compatibleTrustAvailable=false blocks)", () => {
    const pc = scoreProductionConfidence(basePC({ compatibleTrustAvailable: false }));
    expect(pc.meetsMinimumContract).toBe(false);
    expect(pc.blockers.some((b) => /trust video/i.test(b))).toBe(true);
  });
});

// ── Cost gate (#202, §6, §35) ────────────────────────────────────────────────
describe("paid-compute cost gate", () => {
  const KEY = "LEAD_SPRINT_PAID_COMPUTE_ENABLED";
  afterEach(() => { delete process.env[KEY]; });

  const ctx = { leadId: "L1", state: "ranked_pool" as const, meetsMinimumContract: true, isRankedFinalist: true };

  it("is fail-closed: disabled by default → every guarded kind throws", () => {
    expect(paidComputeEnabled()).toBe(false);
    for (const kind of ["deep-analysis", "evidence-capture", "elevenlabs-voice", "render", "other-metered"] as const) {
      expect(() => assertPaidComputeAllowed(kind, ctx)).toThrow(PaidComputeGateError);
    }
  });

  it("allows guarded work only when enabled AND contract met AND finalist AND legal crossing", () => {
    process.env[KEY] = "1";
    expect(() => assertPaidComputeAllowed("elevenlabs-voice", ctx)).not.toThrow();
  });

  it("blocks when contract unmet even if enabled", () => {
    process.env[KEY] = "1";
    expect(() => assertPaidComputeAllowed("render", { ...ctx, meetsMinimumContract: false })).toThrow(/CONTRACT_UNMET|contract/i);
  });

  it("blocks a non-finalist even if enabled", () => {
    process.env[KEY] = "1";
    expect(() => assertPaidComputeAllowed("render", { ...ctx, isRankedFinalist: false })).toThrow(/finalist/i);
  });

  it("blocks an illegal state crossing (not from ranked_pool, not already paid)", () => {
    process.env[KEY] = "1";
    expect(() => assertPaidComputeAllowed("render", { ...ctx, state: "discovered" })).toThrow(/crossing|state/i);
  });

  it("permits continuing paid work from an already-paid state", () => {
    process.env[KEY] = "1";
    expect(() => assertPaidComputeAllowed("render", { ...ctx, state: "voiceover" })).not.toThrow();
  });

  it("never gates discovery/email-delivery (cheap / near-zero)", () => {
    // gate disabled — these still don't throw
    expect(() => assertPaidComputeAllowed("discovery", ctx)).not.toThrow();
    expect(() => assertPaidComputeAllowed("email-delivery", ctx)).not.toThrow();
  });
});

describe("cost ledger honesty (§35)", () => {
  const RATE = "LEAD_SPRINT_RATE_DISCOVERY";
  afterEach(() => { delete process.env[RATE]; });

  it("records measurable units always; USD null when no rate configured (not fabricated)", () => {
    const e = recordCost("render", 3);
    expect(e.units).toBe(3);
    expect(e.knownUsd).toBeNull();
    expect(e.basis).toMatch(/not fabricated/i);
  });

  it("attaches USD only when a provider rate is configured", () => {
    process.env[RATE] = "0.032";
    const e = recordCost("discovery", 100);
    expect(e.knownUsd).toBeCloseTo(3.2, 4);
  });

  it("summary reports known total and the honest list of unpriced kinds", () => {
    const s = summarizeCostLedger([
      { kind: "render", units: 2, unit: "render", knownUsd: null, basis: "unknown" },
      { kind: "discovery", units: 10, unit: "request", knownUsd: 0.32, basis: "env" },
    ]);
    expect(s.knownUsdTotal).toBeCloseTo(0.32, 4);
    expect(s.unknownCostKinds).toContain("render");
  });
});

// ── State model ──────────────────────────────────────────────────────────────
describe("lead sprint states", () => {
  it("the only legal free→paid crossing is ranked_pool → production_finalist", () => {
    expect(canEnterPaid("ranked_pool")).toBe(true);
    expect(canEnterPaid("discovered")).toBe(false);
    expect(canEnterPaid("cheaply_qualified")).toBe(false);
  });
  it("free and paid states are disjoint", () => {
    expect(isFreeState("ranked_pool")).toBe(true);
    expect(isPaidState("ranked_pool")).toBe(false);
    expect(isPaidState("voiceover")).toBe(true);
    expect(isFreeState("voiceover")).toBe(false);
  });
});

// ── Engine (#183) ──────────────────────────────────────────────────────────
function candidate(over: Partial<SprintCandidate> & { leadId: string; sv: number; pcOk?: boolean }): SprintCandidate {
  const { leadId, sv, pcOk = true, ...rest } = over;
  return {
    leadId,
    businessName: `Biz ${leadId}`,
    city: "Greenville",
    state: "SC",
    podId: "greenville-sc",
    podPriority: "priority",
    isDuplicate: false,
    isSuppressed: false,
    cheaplyQualified: true,
    sendValue: scoreSendValue(baseSV({ leadId, digitalReputationGap: sv / 4, reputationStrength: sv / 8, websiteOpportunity: sv / 6 })),
    productionConfidence: scoreProductionConfidence(basePC({ leadId, materialEvidence: pcOk, quickFixEligible: pcOk })),
    ...rest,
  };
}

describe("lead sprint engine (free pipeline #183)", () => {
  it("finalist buffer tracks capacity with a small replacement margin (not a giant backlog)", () => {
    expect(finalistBufferSize(0)).toBe(0);
    expect(finalistBufferSize(4)).toBe(6);   // 4 + ceil(2)
    expect(finalistBufferSize(8)).toBe(12);  // 8 + ceil(4)
    expect(finalistBufferSize(2)).toBe(3);   // 2 + max(1, ceil(1))
  });

  it("partitions suppressed (terminal, audited, never contacted) and duplicates out of the pool", () => {
    const r = runLeadSprint({
      nearTermCapacity: 4,
      candidates: [
        candidate({ leadId: "A", sv: 90 }),
        candidate({ leadId: "B", sv: 80, isSuppressed: true }),
        candidate({ leadId: "C", sv: 70, isDuplicate: true }),
      ],
    });
    expect(r.suppressed).toBe(1);
    expect(r.duplicatesDropped).toBe(1);
    expect(r.rankedPool).toBe(1); // only A
    expect(r.pool.every((c) => !c.isSuppressed && !c.isDuplicate)).toBe(true);
  });

  it("rejects cheap-unqualified leads before paid work (never operator work)", () => {
    const r = runLeadSprint({
      nearTermCapacity: 4,
      candidates: [candidate({ leadId: "A", sv: 90 }), candidate({ leadId: "B", sv: 80, cheaplyQualified: false })],
    });
    expect(r.rejectedBeforePaid).toBe(1);
    expect(r.rankedPool).toBe(1);
  });

  it("ranks by send value desc and sizes finalists to the capacity buffer", () => {
    const r = runLeadSprint({
      nearTermCapacity: 2, // buffer = 3
      candidates: [
        candidate({ leadId: "low", sv: 40 }),
        candidate({ leadId: "high", sv: 96 }),
        candidate({ leadId: "mid", sv: 70 }),
        candidate({ leadId: "mid2", sv: 68 }),
        candidate({ leadId: "mid3", sv: 66 }),
      ],
    });
    expect(r.pool[0].leadId).toBe("high");
    expect(r.pool[0].rank).toBe(1);
    expect(r.finalistBufferSize).toBe(3);
    expect(r.finalists.length).toBe(3); // capped to buffer even though 5 qualified
    expect(r.finalists[0].leadId).toBe("high");
  });

  it("only contract-meeting candidates become finalists", () => {
    const r = runLeadSprint({
      nearTermCapacity: 4,
      candidates: [
        candidate({ leadId: "ok", sv: 90 }),
        candidate({ leadId: "blocked", sv: 95, pcOk: false }), // higher send value but fails contract
      ],
    });
    expect(r.pool[0].leadId).toBe("blocked"); // still ranked by send value
    expect(r.finalists.map((f) => f.leadId)).toEqual(["ok"]); // but only "ok" is finalist-eligible
    expect(r.finalistsMeetingContract).toBe(1);
  });

  it("reports the 20–40 Ready-to-Send standing target and market distribution", () => {
    const r = runLeadSprint({ nearTermCapacity: 4, candidates: [candidate({ leadId: "A", sv: 90 })] });
    expect(r.readyToSendTarget).toEqual({ min: 20, max: 40 });
    expect(r.marketDistribution[0].key).toBe("greenville-sc");
  });
});
