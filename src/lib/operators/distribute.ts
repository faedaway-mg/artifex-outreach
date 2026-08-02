// ─────────────────────────────────────────────────────────────────────────────
// The effectful half of distribution: read state, ask the pure engine what should
// change, and — only if asked to — write it.
//
// The dry run and the real run are the SAME computation. `apply: false` simply
// stops before the writes. That is what makes a preview honest: it is not a
// simulation of the scheduler, it is the scheduler with its hands tied.
//
// Every write is two rows: the lead's new owner, and an audit entry explaining
// why. Ownership history lives in `audit_log` because that table already is the
// workspace's permanent, append-only record — a second history table would be a
// duplicate concept with half the coverage.
// ─────────────────────────────────────────────────────────────────────────────
import {
  listOperators,
  listLeads,
  allTasks,
  allPlans,
  allMeetings,
  updateLead,
  getLead,
  appendAudit,
  insertOperatorIfAbsent,
  auditForTarget,
} from "../repo";
import type { Lead, Operator, AuditEntry } from "../types";
import { SEED_OPERATORS, normalizeOperator, LEGACY_OPERATOR_ID } from "./model";
import {
  planDistribution,
  chooseOwnerForNewLead,
  computeWorkloads,
  type DistributionPlan,
  type Reassignment,
  type Workload,
} from "./assignment";

/** Audit actions that carry ownership history. Nothing else writes these. */
export const OWNERSHIP_ACTIONS = ["lead.assigned", "lead.reassigned", "lead.transferred", "lead.released"] as const;
export type OwnershipAction = (typeof OWNERSHIP_ACTIONS)[number];

/**
 * The policy gate on automatic ownership movement.
 *
 * Shipping the multi-operator code and letting a scheduler start moving a real
 * book of business are two different decisions, and the deploy must not make the
 * second one silently. While this is off, everything READS as multi-operator —
 * the views, the team dashboard, the previews, the timeline — and nothing WRITES
 * ownership automatically. New businesses continue to route to the founding
 * operator exactly as they did before, so the workspace behaves precisely as it
 * does today until someone decides otherwise.
 *
 * Deliberate, human-initiated transfers are NOT gated: a person deciding to hand
 * over a specific relationship is the thing this system exists to record.
 */
export function distributionEnabled(): boolean {
  return process.env.OPERATOR_DISTRIBUTION_ENABLED === "1";
}

export interface DistributionResult extends DistributionPlan {
  applied: boolean;
  /** Reassignments actually written. Empty on a dry run. */
  written: Reassignment[];
}

/**
 * Make sure the workspace has its operators before anything tries to distribute
 * to them. Idempotent — safe to call on every cron tick and every boot.
 */
export async function ensureSeedOperators(): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const seed of SEED_OPERATORS) {
    const now = new Date().toISOString();
    const { created: didCreate } = await insertOperatorIfAbsent(
      normalizeOperator({ ...seed, createdAt: now, updatedAt: now }),
    );
    if (didCreate) created.push(seed.id);
  }
  return { created };
}

async function loadState() {
  const [operators, leads, tasks, plans, meetings] = await Promise.all([
    listOperators(),
    listLeads(),
    allTasks(),
    allPlans(),
    allMeetings(),
  ]);
  return { operators, leads, tasks, plans, meetings };
}

/**
 * Run the distributor.
 *
 * @param mode    "maintain" is the daily automatic pass — rules only, it will
 *                never reshuffle a healthy pipeline. "level" is the deliberate
 *                rebalance and is only ever triggered by an operator.
 * @param apply   false returns the plan and writes nothing.
 * @param actor   who is accountable for the change: an operator id, or "system"
 *                when the nightly cron ran it.
 */
export async function runDistribution(opts: {
  mode?: "maintain" | "level";
  apply: boolean;
  actor: string;
  now?: Date;
}): Promise<DistributionResult> {
  const now = opts.now ?? new Date();
  const { operators, leads, tasks, plans, meetings } = await loadState();

  const plan = planDistribution({
    operators,
    leads,
    tasks,
    ctx: { plans, meetings },
    now,
    mode: opts.mode ?? "maintain",
  });

  if (!opts.apply) return { ...plan, applied: false, written: [] };

  const written: Reassignment[] = [];
  for (const r of plan.reassignments) {
    // Re-read: another operator may have claimed this business between the plan
    // and the write. If ownership moved under us, we skip rather than overwrite.
    const current = await getLead(r.leadId);
    if (!current) continue;
    if (current.assignedTo !== r.from) continue;

    await updateLead(r.leadId, {
      assignedTo: r.to,
      assignedAt: now.toISOString(),
      assignmentReason: r.reason,
    });
    await appendAudit({
      action: r.from ? "lead.reassigned" : "lead.assigned",
      actor: opts.actor,
      targetType: "lead",
      targetId: r.leadId,
      meta: { from: r.from, to: r.to, code: r.code, reason: r.reason, because: r.because },
      ip: null,
    });
    written.push(r);
  }

  return { ...plan, applied: true, written };
}

/**
 * Give a brand-new business an owner at the moment it is created, so it never
 * lands in an unassigned pile waiting for the nightly pass.
 *
 * Returns the owner id, or null when no operator can take work right now — in
 * which case the business stays unassigned and the daily pass will pick it up.
 */
export async function assignNewLead(leadId: string, opts?: { actor?: string; now?: Date }): Promise<string | null> {
  const now = opts?.now ?? new Date();
  const { operators, leads, tasks } = await loadState();

  // Gate off: preserve the pre-existing single-operator behaviour exactly rather
  // than leaving new work with nobody accountable for it.
  const choice = distributionEnabled()
    ? chooseOwnerForNewLead({ operators, leads, tasks, now })
    : operators.some((o) => o.id === LEGACY_OPERATOR_ID)
      ? { operatorId: LEGACY_OPERATOR_ID, reason: "Automatic distribution is off — routed to the founding operator." }
      : null;
  if (!choice) return null;

  await updateLead(leadId, {
    assignedTo: choice.operatorId,
    assignedAt: now.toISOString(),
    assignmentReason: choice.reason,
  });
  await appendAudit({
    action: "lead.assigned",
    actor: opts?.actor ?? "system",
    targetType: "lead",
    targetId: leadId,
    meta: { from: null, to: choice.operatorId, code: "unassigned", reason: choice.reason },
    ip: null,
  });
  return choice.operatorId;
}

/**
 * Hand a business to a specific operator on purpose — vacation cover, an
 * engineering handoff, or a judgement call. This is the ONLY path that may move
 * a live conversation, because a person decided it.
 */
export async function transferLead(input: {
  leadId: string;
  /** null releases the business back to Unassigned. */
  toOperatorId: string | null;
  actor: string;
  reason: string;
  now?: Date;
  /** Set when a manager is operating as someone else. Recorded, never substituted. */
  onBehalfOf?: string | null;
}): Promise<{ ok: boolean; from: string | null }> {
  const now = input.now ?? new Date();
  const lead = await getLead(input.leadId);
  if (!lead) return { ok: false, from: null };
  if ((lead.assignedTo ?? null) === (input.toOperatorId ?? null)) return { ok: false, from: lead.assignedTo };

  await updateLead(input.leadId, {
    assignedTo: input.toOperatorId,
    assignedAt: input.toOperatorId ? now.toISOString() : null,
    assignmentReason: input.reason,
  });
  await appendAudit({
    action: input.toOperatorId ? "lead.transferred" : "lead.released",
    actor: input.actor,
    targetType: "lead",
    targetId: input.leadId,
    meta: {
      from: lead.assignedTo,
      to: input.toOperatorId,
      code: input.toOperatorId ? "manual-transfer" : "manual-release",
      reason: input.reason,
      ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
    },
    ip: null,
  });
  return { ok: true, from: lead.assignedTo };
}

/**
 * Record that an operator actually worked this business. This single timestamp
 * is what stale-ownership expiry reads, so it is deliberately cheap: one column,
 * written from wherever real work happens, never inferred.
 */
export async function touchOperatorActivity(leadId: string, operatorId: string, now = new Date()): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const patch: Partial<Lead> = { lastOperatorActivityAt: now.toISOString() };
  // Working someone else's unowned business claims it — accountability follows
  // the person who is actually doing the work.
  if (!lead.assignedTo) {
    patch.assignedTo = operatorId;
    patch.assignedAt = now.toISOString();
    patch.assignmentReason = "Claimed by working it.";
  }
  await updateLead(leadId, patch);
}

/** Current workloads, for the team dashboard. Read-only. */
export async function currentWorkloads(now = new Date()): Promise<{ operators: Operator[]; loads: Workload[] }> {
  const { operators, leads, tasks } = await loadState();
  const map = computeWorkloads(operators, leads, tasks, now);
  return { operators, loads: [...map.values()] };
}

/** The ownership entries of one business's timeline, newest first. */
export async function ownershipHistory(leadId: string): Promise<AuditEntry[]> {
  const rows = await auditForTarget("lead", leadId);
  return rows.filter((r) => (OWNERSHIP_ACTIONS as readonly string[]).includes(r.action));
}

export { LEGACY_OPERATOR_ID };
