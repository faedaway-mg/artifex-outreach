// ─────────────────────────────────────────────────────────────────────────────
// RAMP STATE STORE (master mandate §28-30) — persists each Google lane's warm-up ramp state + the
// operator-recorded seed placement in the Settings JSONB singleton (namespace `rampState`). No migration;
// survives deploys, exactly like the voice/refill checkpoints. This is what lets the ramp remember where
// each lane is between cron ticks and lets the dashboard show HONEST deliverability (§29).
//
// DEFAULTS encode the true observed state: both lanes start WARMING at Level 1, Gmail seed not_tested, and
// OUTLOOK seed = JUNK — because "the first real Outlook seed tests landed in Junk" (§29). Seeding Junk by
// default means the ramp will NOT auto-promote until an operator records a real Inbox result — fail-closed.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings, appendAudit } from "../repo";
import { laneRampStatus, combinedRampCapacity, type RampState, type SeedPlacement, type LaneRampStatus } from "./ramp";

export interface LaneRampPersist {
  state: RampState;
  level: number;
  updatedAt: string;
}

export interface RampPersistState {
  lanes: Record<string, LaneRampPersist>;   // laneId → persisted state
  seed: { gmail: SeedPlacement; outlook: SeedPlacement };
  updatedAt: string;
}

const LANE_IDS = ["sender-1", "sender-2"] as const;

/** The honest default: WARMING/Level 1 both lanes; Outlook seed = Junk (§29 preserved observation). */
export function defaultRampState(now: string): RampPersistState {
  return {
    lanes: {
      "sender-1": { state: "WARMING", level: 1, updatedAt: now },
      "sender-2": { state: "WARMING", level: 1, updatedAt: now },
    },
    seed: { gmail: "not_tested", outlook: "junk" },
    updatedAt: now,
  };
}

/** Read the persisted ramp state, filling defaults for any missing lane. Never throws. */
export async function getRampState(now: string): Promise<RampPersistState> {
  const settings = await getSettings().catch(() => null);
  const stored = (settings as { rampState?: RampPersistState } | null)?.rampState;
  if (!stored) return defaultRampState(now);
  const base = defaultRampState(now);
  return {
    lanes: {
      "sender-1": stored.lanes?.["sender-1"] ?? base.lanes["sender-1"],
      "sender-2": stored.lanes?.["sender-2"] ?? base.lanes["sender-2"],
    },
    seed: { gmail: stored.seed?.gmail ?? base.seed.gmail, outlook: stored.seed?.outlook ?? base.seed.outlook },
    updatedAt: stored.updatedAt ?? now,
  };
}

/** Persist a lane's ramp transition (from evaluateRamp). Audited. */
export async function setLaneRampState(laneId: string, next: { state: RampState; level: number }, opts: { now: string; actor: string }): Promise<void> {
  const current = await getRampState(opts.now);
  const updated: RampPersistState = {
    ...current,
    lanes: { ...current.lanes, [laneId]: { state: next.state, level: next.level, updatedAt: opts.now } },
    updatedAt: opts.now,
  };
  await updateSettings({ rampState: updated });
  await appendAudit({ action: "ramp.lane_state_set", actor: opts.actor, targetType: "lane", targetId: laneId, meta: { state: next.state, level: next.level }, ip: null }).catch(() => {});
}

/** Operator records a real seed-placement result (§29). Audited. Changing placement can gate promotion. */
export async function setSeedPlacement(provider: "gmail" | "outlook", placement: SeedPlacement, opts: { now: string; actor: string }): Promise<void> {
  const current = await getRampState(opts.now);
  const updated: RampPersistState = { ...current, seed: { ...current.seed, [provider]: placement }, updatedAt: opts.now };
  await updateSettings({ rampState: updated });
  await appendAudit({ action: "ramp.seed_placement_set", actor: opts.actor, targetType: "seed", targetId: provider, meta: { placement }, ip: null }).catch(() => {});
}

export interface RampView {
  lanes: LaneRampStatus[];
  combinedDailyCapacity: number;      // sum of each lane's OWN effective cap (no quota transfer)
  seed: { gmail: SeedPlacement; outlook: SeedPlacement };
  outlookBlocksPromotion: boolean;    // honest §29 surfacing
}

/** The dashboard/cron read-model: per-lane effective capacity + seed placement + honest promotion note. */
export async function rampView(now: string, env: NodeJS.ProcessEnv = process.env): Promise<RampView> {
  const state = await getRampState(now);
  const lanes = LANE_IDS.map((id) => laneRampStatus({ laneId: id, state: state.lanes[id].state, level: state.lanes[id].level }, env));
  return {
    lanes,
    combinedDailyCapacity: combinedRampCapacity(lanes),
    seed: state.seed,
    outlookBlocksPromotion: state.seed.outlook !== "inbox", // not confirmed Inbox → no auto-promotion (§30)
  };
}
