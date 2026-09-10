// ─────────────────────────────────────────────────────────────────────────────
// COST LEDGER STORE (master mandate §15 / #199) — persists MEASURED provider usage so the operator
// cockpit can show honest cost tracking. Append-only, in the Settings JSONB singleton (namespace
// `costLedger`); no migration, survives deploys (exactly like ramp/voice checkpoints).
//
// HONESTY IS THE WHOLE POINT: `units` are always measured (requests / minutes / renders / messages);
// USD is attached ONLY when an operator has configured a provider rate (LEAD_SPRINT_RATE_<KIND>).
// Anything without a configured rate carries knownUsd = null — the ledger NEVER fabricates a $/send.
// Because paid compute is fail-closed OFF and no prospect sends occur during this mandate, the ledger is
// legitimately near-empty — which is the correct, honest state, not a bug.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings, appendAudit } from "../repo";
import { recordCost, summarizeCostLedger, type CostEntry, type PaidComputeKind, type CostLedgerSummary } from "./cost-gate";

export interface PersistedCostEntry extends CostEntry {
  at: string;      // when the usage happened
  actor: string;   // what recorded it (render-worker / voice / analysis / cron)
}

async function readLedger(): Promise<PersistedCostEntry[]> {
  const s = (await getSettings().catch(() => null)) as { costLedger?: PersistedCostEntry[] } | null;
  return s?.costLedger ?? [];
}

/**
 * Append a MEASURED cost entry for a real metered event. Uses the pure recordCost() so USD is present
 * only when a rate is configured. Audited. Never throws into the caller's hot path (best-effort persist).
 */
export async function appendCostEntry(
  kind: PaidComputeKind,
  units: number,
  opts: { actor: string; now: string },
): Promise<PersistedCostEntry> {
  const entry: PersistedCostEntry = { ...recordCost(kind, units), at: opts.now, actor: opts.actor };
  const current = await readLedger();
  await updateSettings({ costLedger: [...current, entry] }).catch(() => {});
  await appendAudit({
    action: "cost.ledger_entry",
    actor: opts.actor,
    targetType: "cost",
    targetId: kind,
    meta: { units, unit: entry.unit, knownUsd: entry.knownUsd },
    ip: null,
  }).catch(() => {});
  return entry;
}

export async function getCostLedgerEntries(): Promise<PersistedCostEntry[]> {
  return readLedger();
}

export interface CostKindRollup {
  kind: PaidComputeKind;
  units: number;
  unit: string;
  knownUsd: number | null;   // null when NO entry for this kind carried a configured rate (honest unknown)
  events: number;
}

export interface CostLedgerView {
  summary: CostLedgerSummary;                 // known total + which kinds are unknown
  byKind: CostKindRollup[];                    // per-provider rollup for the cockpit
  totalEvents: number;
  /** Derived efficiency metrics; each is null until the denominator actually exists (no fabrication). */
  perPreparedPackage: number | null;
  perSuccessfulSend: number | null;
  perReply: number | null;
  perPositiveReply: number | null;
  perPurchase: number | null;
}

/**
 * The cockpit read-model over the persisted ledger. Rolls entries up per provider kind, keeping USD null
 * for any kind with no configured rate. Efficiency metrics (cost per package/send/reply/purchase) are
 * null until real outcome counts exist — the mandate explicitly accepts "unavailable until real sends".
 */
export function costLedgerView(
  entries: PersistedCostEntry[],
  outcomes: { preparedPackages?: number; successfulSends?: number; replies?: number; positiveReplies?: number; purchases?: number } = {},
): CostLedgerView {
  const summary = summarizeCostLedger(entries);
  const rollups = new Map<PaidComputeKind, CostKindRollup>();
  for (const e of entries) {
    const r = rollups.get(e.kind) ?? { kind: e.kind, units: 0, unit: e.unit, knownUsd: null, events: 0 };
    r.units += e.units;
    r.events += 1;
    if (e.knownUsd != null) r.knownUsd = Math.round(((r.knownUsd ?? 0) + e.knownUsd) * 10000) / 10000;
    rollups.set(e.kind, r);
  }
  const knownTotal = summary.knownUsdTotal;
  // A per-X metric is only meaningful when (a) we have a known USD total AND (b) a positive denominator.
  const per = (n: number | undefined): number | null =>
    n && n > 0 && knownTotal > 0 ? Math.round((knownTotal / n) * 10000) / 10000 : null;

  return {
    summary,
    byKind: [...rollups.values()].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    totalEvents: entries.length,
    perPreparedPackage: per(outcomes.preparedPackages),
    perSuccessfulSend: per(outcomes.successfulSends),
    perReply: per(outcomes.replies),
    perPositiveReply: per(outcomes.positiveReplies),
    perPurchase: per(outcomes.purchases),
  };
}

/** Convenience: read + summarize in one call for the dashboard. */
export async function getCostLedgerView(
  outcomes?: Parameters<typeof costLedgerView>[1],
): Promise<CostLedgerView> {
  return costLedgerView(await readLedger(), outcomes);
}
