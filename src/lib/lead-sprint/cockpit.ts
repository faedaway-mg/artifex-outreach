// ─────────────────────────────────────────────────────────────────────────────
// OPERATOR COCKPIT READ-MODEL (master mandate §14 / #199) — the ONE surface that summarizes the machine
// so the operator manages the SYSTEM, not lead-by-lead. It COMPOSES already-built, already-tested
// read-models (platform health, launch readiness GO/NO-GO, the persisted ramp view, the Lead Sprint
// snapshot, the cost ledger) into a single serializable CockpitView the dashboard renders.
//
// HONESTY: every number here traces to a real read-model. Outcomes (sent/replies/purchases) are surfaced
// only when they exist — during this mandate delivery is OFF and no prospect is contacted, so those are
// legitimately zero/unavailable, NOT fabricated. The pure assembler is unit-tested; the async composer
// just fetches and delegates.
// ─────────────────────────────────────────────────────────────────────────────
import type { LaunchReadiness } from "../launch/launch-readiness";
import type { RampView } from "../comms/ramp-store";
import type { LeadSprintSnapshot } from "./snapshot";
import type { CostLedgerView } from "./cost-ledger-store";

export interface CockpitLane {
  laneId: string;
  state: string;            // WARMING | RAMPING | ESTABLISHED | PAUSED
  level: number;
  effectiveDailyCap: number;
  seed: { gmail: string; outlook: string };
  blocksPromotion: boolean; // honest §29 surfacing (Outlook Junk blocks auto-promotion)
}

export interface CockpitOutcomes {
  // All null/zero until real sends occur — never fabricated (§14 "Do not invent unavailable data").
  sent: number | null;
  replies: number | null;
  positiveReplies: number | null;
  optOuts: number | null;
  bounces: number | null;
  purchases: number | null;
}

export interface CockpitView {
  generatedAt: string;
  systemHealth: { status: string; alerts: string[] };
  launchReadiness: { state: LaunchReadiness["state"]; blockers: string[]; performsSend: false };
  lanes: CockpitLane[];
  combinedDailyCapacity: number;
  leadSprint: {
    discovered: number;
    cheaplyQualified: number;
    rankedPool: number;
    finalists: number;
    finalistsMeetingContract: number;
    readyToSendTarget: { min: number; max: number };
    rejectedBeforePaid: number;
    excludedLegacy: number;
    avgSendValue: number;
  };
  production: {
    // Production/media counts default to 0/unavailable until the gated paid pipeline runs.
    voiceovers: number;
    renders: number;
    breakbotFailures: number;
    replacementCandidates: number;
  };
  cost: CostLedgerView;
  outcomes: CockpitOutcomes;
  /** Standing safety posture — always shown so the operator can see delivery is OFF at a glance. */
  safety: { prospectDeliveryOn: boolean; autosendOn: boolean; prospectTransport: "google-workspace"; transactionalTransport: "resend" };
}

export interface AssembleCockpitInput {
  now: string;
  health: { status: string; alerts: string[] };
  readiness: Pick<LaunchReadiness, "state" | "blockers">;
  ramp: RampView;
  sprint: Pick<LeadSprintSnapshot,
    "discovered" | "cheaplyQualified" | "rankedPool" | "rejectedBeforePaid" | "avgSendValue" |
    "finalists" | "finalistsMeetingContract" | "readyToSendTarget" | "excludedLegacy"> & { finalists: LeadSprintSnapshot["finalists"] };
  cost: CostLedgerView;
  production?: Partial<CockpitView["production"]>;
  outcomes?: Partial<CockpitOutcomes>;
  safety?: { prospectDeliveryOn?: boolean; autosendOn?: boolean };
}

/** Shape the cockpit from already-fetched read-models. PURE + deterministic — the unit-tested core. */
export function assembleCockpit(i: AssembleCockpitInput): CockpitView {
  const lanes: CockpitLane[] = i.ramp.lanes.map((l) => ({
    laneId: l.laneId,
    state: l.state,
    level: l.level,
    effectiveDailyCap: l.effectiveDailyCap,
    seed: { gmail: i.ramp.seed.gmail, outlook: i.ramp.seed.outlook },
    blocksPromotion: i.ramp.outlookBlocksPromotion,
  }));

  return {
    generatedAt: i.now,
    systemHealth: { status: i.health.status, alerts: i.health.alerts },
    launchReadiness: { state: i.readiness.state, blockers: i.readiness.blockers, performsSend: false },
    lanes,
    combinedDailyCapacity: i.ramp.combinedDailyCapacity,
    leadSprint: {
      discovered: i.sprint.discovered,
      cheaplyQualified: i.sprint.cheaplyQualified,
      rankedPool: i.sprint.rankedPool,
      finalists: i.sprint.finalists.length,
      finalistsMeetingContract: i.sprint.finalistsMeetingContract,
      readyToSendTarget: i.sprint.readyToSendTarget,
      rejectedBeforePaid: i.sprint.rejectedBeforePaid,
      excludedLegacy: i.sprint.excludedLegacy,
      avgSendValue: i.sprint.avgSendValue,
    },
    production: {
      voiceovers: i.production?.voiceovers ?? 0,
      renders: i.production?.renders ?? 0,
      breakbotFailures: i.production?.breakbotFailures ?? 0,
      replacementCandidates: i.production?.replacementCandidates ?? 0,
    },
    cost: i.cost,
    outcomes: {
      // Delivery is OFF this mandate → no outcomes exist yet. Null = honestly unavailable.
      sent: i.outcomes?.sent ?? null,
      replies: i.outcomes?.replies ?? null,
      positiveReplies: i.outcomes?.positiveReplies ?? null,
      optOuts: i.outcomes?.optOuts ?? null,
      bounces: i.outcomes?.bounces ?? null,
      purchases: i.outcomes?.purchases ?? null,
    },
    safety: {
      prospectDeliveryOn: i.safety?.prospectDeliveryOn ?? false,
      autosendOn: i.safety?.autosendOn ?? false,
      prospectTransport: "google-workspace",
      transactionalTransport: "resend",
    },
  };
}

/**
 * Build the live cockpit by fetching each read-model and composing them. Thin — all real logic lives in
 * the pure read-models + assembleCockpit. Read-only: fetches, never writes, never sends.
 */
export async function buildOperatorCockpit(now: string): Promise<CockpitView> {
  const [{ platformHealth }, { computeLaunchReadiness }, { rampView }, { computeLeadSprintSnapshot }, { getCostLedgerView }] =
    await Promise.all([
      import("../launch/health"),
      import("../launch/launch-readiness"),
      import("../comms/ramp-store"),
      import("./snapshot"),
      import("./cost-ledger-store"),
    ]);

  const ramp = await rampView(now);
  const [health, readiness, sprint, cost] = await Promise.all([
    platformHealth(new Date(now)),
    computeLaunchReadiness(),
    computeLeadSprintSnapshot({ now, nearTermCapacity: ramp.combinedDailyCapacity, podsOnly: true }),
    getCostLedgerView(),
  ]);

  return assembleCockpit({
    now,
    health: { status: String(health.status), alerts: health.alerts },
    readiness: { state: readiness.state, blockers: readiness.blockers },
    ramp,
    sprint,
    cost,
  });
}
