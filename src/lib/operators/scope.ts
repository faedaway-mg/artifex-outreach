// ─────────────────────────────────────────────────────────────────────────────
// Queue scope — the operator-aware view of the SAME queue.
//
// There is exactly one queue engine (`buildWorkQueue`) and it already ignores any
// task whose business is not in the lead map it was handed. So making Today
// operator-aware needs no second queue and no second scheduler: it narrows the
// input set, and everything downstream behaves as it always has.
//
// The narrowing MUST happen before the daily cap is applied. Slicing to the cap
// first and filtering second would silently starve whoever's work sorted lower —
// the queue would look empty while their businesses waited.
//
// Pure: no I/O, no clock of its own, no randomness.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Operator, Task } from "../types";
import { canReceiveNewWork, shortName } from "./model";
import {
  isActiveConversation,
  idleBusinessDays,
  DEFAULT_POLICY,
  TERMINAL_STAGES,
  type DistributionContext,
  type DistributionPolicy,
} from "./assignment";

export type ScopeKind = "mine" | "operator" | "unassigned" | "team" | "all";

export interface QueueScope {
  kind: ScopeKind;
  /** For "operator": whose work is being viewed. For "mine": the viewer. */
  operatorId: string | null;
}

/** The value that appears in the URL, e.g. `?view=alex`. */
export function scopeToParam(scope: QueueScope): string {
  switch (scope.kind) {
    case "mine": return "mine";
    case "operator": return scope.operatorId ?? "mine";
    case "unassigned": return "unassigned";
    case "team": return "team";
    case "all": return "all";
  }
}

/**
 * Read a scope off the URL. Anything unrecognised falls back to "mine", because
 * the default must always be the operator's own work — the promise is that they
 * never have to think about whose lead something is.
 */
export function parseScope(raw: string | string[] | undefined, viewerId: string, operatorIds: string[]): QueueScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value === "mine" || value === viewerId) return { kind: "mine", operatorId: viewerId };
  if (value === "unassigned") return { kind: "unassigned", operatorId: null };
  if (value === "team") return { kind: "team", operatorId: null };
  if (value === "all") return { kind: "all", operatorId: null };
  if (operatorIds.includes(value)) return { kind: "operator", operatorId: value };
  return { kind: "mine", operatorId: viewerId };
}

export function scopeLabel(scope: QueueScope, operators: Operator[]): string {
  switch (scope.kind) {
    case "mine": return "My businesses";
    case "operator": {
      const op = operators.find((o) => o.id === scope.operatorId);
      return op ? `${shortName(op)}'s businesses` : "Their businesses";
    }
    case "unassigned": return "Unassigned";
    case "team": return "Team queue";
    case "all": return "All businesses";
  }
}

/** One-line explanation of what the view is for, shown under the switcher. */
export function scopeMeaning(scope: QueueScope): string {
  switch (scope.kind) {
    case "mine": return "Work you are accountable for today.";
    case "operator": return "What they are accountable for — read to coordinate, not to duplicate.";
    case "unassigned": return "Businesses with nobody accountable yet.";
    case "team": return "Work at risk of stalling: unassigned, or owned by someone who cannot work it right now.";
    case "all": return "Everything, regardless of who owns it.";
  }
}

/**
 * Is this business at risk of stalling — nobody accountable, an owner who cannot
 * work it, or ownership that has expired through silence?
 *
 * This is the same shape of judgement the distributor makes, expressed as a view
 * so an operator can SEE what the nightly pass is about to act on.
 */
export function needsAttention(input: {
  lead: Lead;
  operators: Operator[];
  ctx: DistributionContext;
  now: Date;
  policy?: DistributionPolicy;
}): boolean {
  const { lead, operators, ctx, now } = input;
  const policy = input.policy ?? ctx.policy ?? DEFAULT_POLICY;
  if (TERMINAL_STAGES.has(lead.pipelineStage)) return false;
  if (!lead.assignedTo) return true;

  const owner = operators.find((o) => o.id === lead.assignedTo);
  if (!owner) return true;
  if (!canReceiveNewWork(owner)) {
    // Engineering focus deliberately keeps live conversations; only quiet work
    // is at risk, and only quiet work should appear here.
    if (owner.availabilityMode === "engineering") return !isActiveConversation(lead, ctx, now);
    return true;
  }
  if (isActiveConversation(lead, ctx, now)) return false;
  const idle = idleBusinessDays(lead, now);
  return idle !== null && idle >= policy.staleAfterBusinessDays;
}

/**
 * The businesses a scope contains. Returned as a Set of lead ids so the caller
 * can filter tasks in one pass, before the cap.
 */
export function leadIdsInScope(input: {
  scope: QueueScope;
  viewerId: string;
  leads: Lead[];
  operators: Operator[];
  ctx: DistributionContext;
  now: Date;
}): Set<string> {
  const { scope, viewerId, leads, operators, ctx, now } = input;
  const out = new Set<string>();
  for (const lead of leads) {
    let include = false;
    switch (scope.kind) {
      case "all": include = true; break;
      case "mine": include = lead.assignedTo === (scope.operatorId ?? viewerId); break;
      case "operator": include = lead.assignedTo === scope.operatorId; break;
      case "unassigned": include = !lead.assignedTo; break;
      case "team": include = needsAttention({ lead, operators, ctx, now }); break;
    }
    if (include) out.add(lead.id);
  }
  return out;
}

/** Apply a scope to tasks. Deliberately separate from the cap. */
export function tasksInScope(tasks: Task[], leadIds: Set<string>): Task[] {
  return tasks.filter((t) => leadIds.has(t.leadId));
}

export interface ScopeOption {
  param: string;
  label: string;
  /** Businesses in this view — shown so a switcher never hides work. */
  count: number;
}

/** The switcher's options, in a fixed order, each with an honest count. */
export function scopeOptions(input: {
  viewerId: string;
  leads: Lead[];
  operators: Operator[];
  ctx: DistributionContext;
  now: Date;
}): ScopeOption[] {
  // Finished businesses are excluded from the counts: they are still IN the view
  // (so a lingering task on a Won business is never hidden) but counting them
  // would inflate the number an operator reads as "work waiting for me".
  const active = new Set(input.leads.filter((l) => !TERMINAL_STAGES.has(l.pipelineStage)).map((l) => l.id));
  const count = (scope: QueueScope) => [...leadIdsInScope({ ...input, scope })].filter((id) => active.has(id)).length;
  const options: ScopeOption[] = [
    { param: "mine", label: "Mine", count: count({ kind: "mine", operatorId: input.viewerId }) },
  ];
  for (const op of input.operators) {
    if (op.id === input.viewerId || !op.active) continue;
    options.push({ param: op.id, label: shortName(op), count: count({ kind: "operator", operatorId: op.id }) });
  }
  options.push({ param: "unassigned", label: "Unassigned", count: count({ kind: "unassigned", operatorId: null }) });
  options.push({ param: "team", label: "Team", count: count({ kind: "team", operatorId: null }) });
  options.push({ param: "all", label: "All", count: count({ kind: "all", operatorId: null }) });
  return options;
}
