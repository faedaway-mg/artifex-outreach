// ─────────────────────────────────────────────────────────────────────────────
// NATIONAL LEAD SPRINT — FREE PIPELINE ENGINE (master mandate §4-8, THE single engine for track #183).
//
// Pure + deterministic. Given already-scored candidates (an adapter maps real Lead data into this shape),
// it runs the free lifecycle — dedupe → suppression → cheap qualification → rank by Send Value → ranked
// pool — and selects a SMALL finalist buffer sized to near-term capacity. It performs ZERO paid compute
// and never contacts a prospect; it only decides WHO is worth (future, gated) paid production and in what
// order. Crossing into paid production is the cost gate's job (#202), never this engine's.
//
// Sizing discipline (§6, §34): the finalist buffer tracks legitimate near-term capacity plus a small
// replacement margin so a late failure can be back-filled from the next-ranked candidate — never a giant
// pre-paid backlog. A much larger cheap-qualified pool sits behind the finalists at no paid cost.
// ─────────────────────────────────────────────────────────────────────────────
import type { PodPriority } from "./pods";
import { regionForLead } from "./pods";
import type { SendValueScore } from "./send-value";
import type { ProductionConfidence } from "./production-confidence";
import type { LeadSprintState } from "./states";

export const LEAD_SPRINT_ENGINE_VERSION = "v1-2026-09";

export interface SprintCandidate {
  leadId: string;
  businessName: string;
  city: string;
  state: string;
  podId: string | null;
  podPriority: PodPriority | "none";
  sendValue: SendValueScore;
  productionConfidence: ProductionConfidence;
  // Free-pipeline gate outcomes (computed upstream at zero cost; the engine partitions on them).
  isDuplicate: boolean;
  isSuppressed: boolean;
  cheaplyQualified: boolean;
}

export interface RankedCandidate extends SprintCandidate {
  lifecycle: LeadSprintState; // resolved lifecycle state (free half only, until the cost gate promotes)
  rank: number | null;        // position in the ranked pool (1 = highest send value); null if not pooled
}

export interface MarketDistributionCell {
  key: string;      // pod label or region
  candidates: number;
  finalists: number;
}

export interface FinalistSelection {
  leadId: string;
  businessName: string;
  sendValue: number;
  productionConfidence: number;
  reason: string;
}

export interface LeadSprintReport {
  version: string;
  // ── funnel counts (states.ts vocabulary) ──
  discovered: number;
  deduped: number;              // survived dedupe (unique)
  duplicatesDropped: number;
  suppressed: number;           // terminal, NOT contacted, kept for audit
  cheaplyQualified: number;
  rankedPool: number;           // scored candidates in the pool behind the paid boundary
  rejectedBeforePaid: number;   // failed cheap qualification (never reached scoring/paid)
  // ── finalist selection (sized to capacity; the ONLY candidates eligible to cross the gate) ──
  nearTermCapacity: number;
  finalistBufferSize: number;
  finalists: FinalistSelection[];
  finalistsMeetingContract: number;
  // ── quality + distribution ──
  avgSendValue: number;
  readyToSendTarget: { min: number; max: number };
  marketDistribution: MarketDistributionCell[];
  // ── ordered pool (highest send value first) ──
  pool: RankedCandidate[];
}

// The standing behind-the-gate inventory target (§7): 20–40 fully prepared Ready-to-Send packages.
export const READY_TO_SEND_TARGET = { min: 20, max: 40 } as const;

/**
 * Size the finalist buffer from near-term capacity: capacity + a ~50% replacement margin (min +1) so a
 * late failure can be back-filled (§34) — deliberately small, never a 100-package backlog (§6).
 */
export function finalistBufferSize(nearTermCapacity: number): number {
  const cap = Math.max(0, Math.floor(nearTermCapacity));
  if (cap === 0) return 0;
  return cap + Math.max(1, Math.ceil(cap * 0.5));
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Run the free Lead Sprint pipeline over a batch of candidates. Deterministic ordering: Send Value desc,
 * then Production Confidence desc, then leadId asc (stable). No paid compute, no side effects.
 */
export function runLeadSprint(input: {
  candidates: SprintCandidate[];
  nearTermCapacity: number;
}): LeadSprintReport {
  const { candidates, nearTermCapacity } = input;
  const discovered = candidates.length;

  // Suppression is terminal and comes first — a suppressed lead is never contacted, only audited.
  const suppressed = candidates.filter((c) => c.isSuppressed);
  const afterSuppression = candidates.filter((c) => !c.isSuppressed);

  // Dedupe: drop duplicates (kept out of the active pool; upstream retains the original).
  const unique = afterSuppression.filter((c) => !c.isDuplicate);
  const duplicatesDropped = afterSuppression.length - unique.length;

  // Cheap qualification: those that fail are rejected BEFORE any scoring/paid work (never operator work).
  const qualified = unique.filter((c) => c.cheaplyQualified);
  const rejectedBeforePaid = unique.length - qualified.length;

  // Rank the qualified pool by Send Value (stable, deterministic).
  const ranked = [...qualified].sort((a, b) => {
    if (b.sendValue.total !== a.sendValue.total) return b.sendValue.total - a.sendValue.total;
    if (b.productionConfidence.total !== a.productionConfidence.total) return b.productionConfidence.total - a.productionConfidence.total;
    return a.leadId.localeCompare(b.leadId);
  });

  const pool: RankedCandidate[] = ranked.map((c, idx) => ({ ...c, lifecycle: "ranked_pool", rank: idx + 1 }));

  // Finalist selection: only candidates that MEET the minimum Production Confidence contract are eligible,
  // taken top-down by rank up to the capacity-sized buffer. This is the only set the cost gate may admit.
  const bufferSize = finalistBufferSize(nearTermCapacity);
  const eligible = pool.filter((c) => c.productionConfidence.meetsMinimumContract);
  const finalists: FinalistSelection[] = eligible.slice(0, bufferSize).map((c) => ({
    leadId: c.leadId,
    businessName: c.businessName,
    sendValue: c.sendValue.total,
    productionConfidence: c.productionConfidence.total,
    reason: `Rank #${c.rank} · Send Value ${c.sendValue.total} (${c.sendValue.band}) · Production Confidence ${c.productionConfidence.total} (${c.productionConfidence.band})`,
  }));

  const avgSendValue = pool.length ? round(pool.reduce((s, c) => s + c.sendValue.total, 0) / pool.length) : 0;

  // Market distribution by pod (falls back to region for unpodded leads), with finalist counts.
  const finalistIds = new Set(finalists.map((f) => f.leadId));
  const cells = new Map<string, MarketDistributionCell>();
  for (const c of pool) {
    // Group by pod when the lead is in one; otherwise fall back to its US region (from the US state code).
    const label = c.podId ?? regionForLead(c.state);
    const cell = cells.get(label) ?? { key: label, candidates: 0, finalists: 0 };
    cell.candidates += 1;
    if (finalistIds.has(c.leadId)) cell.finalists += 1;
    cells.set(label, cell);
  }

  return {
    version: LEAD_SPRINT_ENGINE_VERSION,
    discovered,
    deduped: unique.length,
    duplicatesDropped,
    suppressed: suppressed.length,
    cheaplyQualified: qualified.length,
    rankedPool: pool.length,
    rejectedBeforePaid,
    nearTermCapacity,
    finalistBufferSize: bufferSize,
    finalists,
    finalistsMeetingContract: eligible.length,
    avgSendValue,
    readyToSendTarget: READY_TO_SEND_TARGET,
    marketDistribution: [...cells.values()].sort((a, b) => b.candidates - a.candidates),
    pool,
  };
}
