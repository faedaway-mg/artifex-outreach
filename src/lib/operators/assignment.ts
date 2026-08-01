// ─────────────────────────────────────────────────────────────────────────────
// The distribution engine — PURE. No I/O, no clock, no randomness.
//
// It answers one question: given the operators, the businesses, and the work
// that exists, who should be accountable for what right now — and WHY.
//
// Four promises, in priority order. Where they conflict, the earlier one wins.
//
//   1. No duplicate outreach.   One business, exactly one accountable operator.
//   2. Continuity is sacred.    A live conversation is never moved by automation.
//   3. No stale pipelines.      Quiet work does not sit forever with someone who
//                               has stopped working it — including someone who
//                               has gone heads-down on engineering.
//   4. No manual balancing.     Capacity decides the split, every morning.
//
// Every decision carries a structured reason. Nothing here is random: with the
// same inputs it returns the same plan, in the same order, forever. That is what
// makes the audit trail trustworthy rather than decorative.
// ─────────────────────────────────────────────────────────────────────────────
import type { AcquisitionPlan, Lead, Meeting, Operator, Task } from "../types";
import { canReceiveNewWork, activeConversationsTransferable, shortName } from "./model";
import { workKindForTask } from "../work-queue";

/** Businesses in these stages are finished. They are never redistributed. */
export const TERMINAL_STAGES = new Set(["Won", "Lost", "Disqualified", "Closed Won", "Closed Lost", "Client"]);

/**
 * Stages that mean a real conversation is under way. Reaching one of these is an
 * event the operator caused; moving the business afterwards would hand a stranger
 * a relationship mid-sentence.
 */
export const CONVERSATION_STAGES = new Set([
  "Contacted", "Follow-Up", "Nurture", "Discovery Complete", "Proposal Sent", "Negotiation", "Agreement Sent",
]);

export interface DistributionPolicy {
  /**
   * Business days of operator silence after which ownership expires and the
   * business becomes eligible for reassignment. Only ever applied to work that
   * is NOT an active conversation.
   */
  staleAfterBusinessDays: number;
  /** A business contacted within this window still counts as a live conversation. */
  activeConversationDays: number;
}

export const DEFAULT_POLICY: DistributionPolicy = {
  staleAfterBusinessDays: 4,
  activeConversationDays: 14,
};

/** Whole weekdays between two instants (Sat/Sun excluded). Never negative. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) days += 1;
  }
  return days;
}

export interface DistributionContext {
  /** Every plan in the workspace; only active ones matter. */
  plans: AcquisitionPlan[];
  meetings: Meeting[];
  policy?: DistributionPolicy;
}

/**
 * Is there a live relationship here that automation must not disturb?
 *
 * Read from state that already exists — an active sequence, a conversational
 * pipeline stage, a recent touch, or a meeting still ahead. Nothing is invented
 * and nothing new is persisted to answer this.
 */
export function isActiveConversation(lead: Lead, ctx: DistributionContext, now: Date): boolean {
  const policy = ctx.policy ?? DEFAULT_POLICY;
  if (ctx.plans.some((p) => p.leadId === lead.id && p.status === "active")) return true;
  if (CONVERSATION_STAGES.has(lead.pipelineStage)) return true;
  if (ctx.meetings.some((m) => m.leadId === lead.id && new Date(m.scheduledAt) >= now)) return true;
  if (lead.lastContactAt) {
    const days = (now.getTime() - new Date(lead.lastContactAt).getTime()) / 86_400_000;
    if (days <= policy.activeConversationDays) return true;
  }
  return false;
}

/** Business days since an operator last touched this business. null = never. */
export function idleBusinessDays(lead: Lead, now: Date): number | null {
  const last = lead.lastOperatorActivityAt ?? lead.assignedAt;
  if (!last) return null;
  return businessDaysBetween(new Date(last), now);
}

// ── Workload ─────────────────────────────────────────────────────────────────

export interface Workload {
  operatorId: string;
  /** Businesses this operator is accountable for, excluding finished ones. */
  leadsOwned: number;
  /** Open tasks across those businesses — the honest size of the backlog. */
  openTasks: number;
  /** Distinct businesses with work due today — what capacity actually governs. */
  dueToday: number;
  capacity: number;
  /** Slots left today. Negative means over capacity. */
  headroom: number;
}

const endOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

export function computeWorkloads(operators: Operator[], leads: Lead[], tasks: Task[], now: Date): Map<string, Workload> {
  const eod = endOfDay(now).getTime();
  const ownerOf = new Map(leads.map((l) => [l.id, l.assignedTo]));
  const out = new Map<string, Workload>();
  for (const op of operators) {
    out.set(op.id, { operatorId: op.id, leadsOwned: 0, openTasks: 0, dueToday: 0, capacity: op.dailyCapacity, headroom: op.dailyCapacity });
  }
  for (const lead of leads) {
    if (!lead.assignedTo || TERMINAL_STAGES.has(lead.pipelineStage)) continue;
    const w = out.get(lead.assignedTo);
    if (w) w.leadsOwned += 1;
  }
  const dueLeads = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (task.status !== "open") continue;
    const owner = ownerOf.get(task.leadId);
    if (!owner) continue;
    const w = out.get(owner);
    if (!w) continue;
    w.openTasks += 1;
    const snoozed = task.snoozedUntil && new Date(task.snoozedUntil).getTime() > now.getTime();
    if (!snoozed && new Date(task.dueAt).getTime() <= eod) {
      const set = dueLeads.get(owner) ?? new Set<string>();
      set.add(task.leadId);
      dueLeads.set(owner, set);
    }
  }
  for (const [id, set] of dueLeads) {
    const w = out.get(id);
    if (w) w.dueToday = set.size;
  }
  for (const w of out.values()) w.headroom = w.capacity - w.dueToday;
  return out;
}

// ── The decision ─────────────────────────────────────────────────────────────

export type ReassignCode =
  | "unassigned"
  | "owner-unknown"
  | "owner-inactive"
  | "owner-engineering"
  | "owner-away"
  | "ownership-stale"
  | "workload-levelling";

export interface Reassignment {
  leadId: string;
  businessName: string;
  from: string | null;
  to: string;
  code: ReassignCode;
  /** One sentence an operator can read months later and still understand. */
  reason: string;
  /** Why THIS operator won, in the order the tie-breaks were applied. */
  because: string[];
}

export interface HeldLead {
  leadId: string;
  code: ReassignCode | "no-available-operator" | "already-best";
  reason: string;
}

export interface DistributionPlan {
  reassignments: Reassignment[];
  /** Businesses that were eligible to move but deliberately did not. */
  held: HeldLead[];
  /** Workloads AFTER the plan is applied — what the report shows. */
  projected: Workload[];
  consideredLeads: number;
}

/** Why this business is (or is not) eligible to change hands right now. */
function eligibility(
  lead: Lead,
  owner: Operator | undefined,
  ctx: DistributionContext,
  now: Date,
): { code: ReassignCode; reason: string } | null {
  const policy = ctx.policy ?? DEFAULT_POLICY;
  const live = isActiveConversation(lead, ctx, now);

  if (!lead.assignedTo) return { code: "unassigned", reason: "No operator was accountable for this business." };
  if (!owner) return { code: "owner-unknown", reason: `Previous owner "${lead.assignedTo}" is not an operator in this workspace.` };

  if (!owner.active) {
    return { code: "owner-inactive", reason: `${shortName(owner)} is no longer an active operator.` };
  }
  if (owner.availabilityMode === "away") {
    // Away means cover everything, including live conversations.
    return { code: "owner-away", reason: `${shortName(owner)} is away — covering their work.` };
  }
  if (owner.availabilityMode === "engineering") {
    // Engineering focus PROTECTS live conversations and releases only quiet work.
    if (live) return null;
    return { code: "owner-engineering", reason: `${shortName(owner)} is in engineering focus — moving quiet work so the pipeline keeps going.` };
  }

  if (live) return null; // Promise 2: automation never moves a live conversation.

  const idle = idleBusinessDays(lead, now);
  if (idle !== null && idle >= policy.staleAfterBusinessDays) {
    return { code: "ownership-stale", reason: `No operator activity for ${idle} business days — ownership expired.` };
  }
  return null;
}

/**
 * Rank the operators who could take this business. Deterministic and explained.
 * Order of tie-breaks is the policy: capacity first (promise 4), then total
 * backlog, then fit, then locality, then a stable id sort so the result never
 * depends on map iteration order.
 */
function rank(
  lead: Lead,
  nextKind: string | null,
  candidates: Operator[],
  loads: Map<string, Workload>,
  localityByOperator: Map<string, Set<string>>,
): Array<{ op: Operator; because: string[] }> {
  const scored = candidates.map((op) => {
    const w = loads.get(op.id)!;
    const prefers = nextKind != null && op.preferredWorkKinds.includes(nextKind);
    const local = localityByOperator.get(op.id)?.has(`${lead.city}|${lead.state}`) ?? false;
    return { op, w, prefers, local };
  });
  scored.sort((a, b) =>
    b.w.headroom - a.w.headroom ||
    a.w.leadsOwned - b.w.leadsOwned ||
    Number(b.prefers) - Number(a.prefers) ||
    Number(b.local) - Number(a.local) ||
    (a.op.id < b.op.id ? -1 : a.op.id > b.op.id ? 1 : 0),
  );
  return scored.map((s) => ({
    op: s.op,
    because: [
      `${s.w.dueToday} of ${s.w.capacity} slots used today`,
      `${s.w.leadsOwned} businesses owned`,
      ...(s.prefers && nextKind ? [`prefers ${nextKind} work`] : []),
      ...(s.local ? [`already works ${lead.city}, ${lead.state}`] : []),
    ],
  }));
}

/**
 * Decide the ownership changes for right now.
 *
 * Nothing is written here. The caller applies the plan, and the caller is the
 * only place a row changes — so a dry run is the same computation as the real
 * one, which is what makes "preview before apply" honest rather than a mock.
 */
export function planDistribution(input: {
  operators: Operator[];
  leads: Lead[];
  tasks: Task[];
  ctx: DistributionContext;
  now: Date;
  /**
   * "maintain" — the daily pass. Only moves what the rules say must move:
   *   unassigned work, work owned by someone who cannot work it, expired
   *   ownership. It will never reshuffle a healthy pipeline.
   *
   * "level" — the deliberate rebalance. Additionally spreads QUIET work off
   *   over-loaded operators until owned counts are within one of each other.
   *   Live conversations are still untouchable. This is what turns "Jordan owns
   *   all 32 and Alex owns none" into a shared workspace without anybody
   *   dividing a spreadsheet — and it is operator-triggered, because silently
   *   moving half a book of business overnight is not something a system
   *   should decide on its own.
   */
  mode?: "maintain" | "level";
}): DistributionPlan {
  const { operators, leads, tasks, ctx, now } = input;
  const mode = input.mode ?? "maintain";
  const opById = new Map(operators.map((o) => [o.id, o]));
  const loads = computeWorkloads(operators, leads, tasks, now);
  const receivers = operators.filter(canReceiveNewWork);

  // Which localities each operator already works — used only as a late tie-break.
  const localityByOperator = new Map<string, Set<string>>();
  for (const l of leads) {
    if (!l.assignedTo) continue;
    const set = localityByOperator.get(l.assignedTo) ?? new Set<string>();
    set.add(`${l.city}|${l.state}`);
    localityByOperator.set(l.assignedTo, set);
  }

  // The next piece of work on each business — used to honour work-type preference.
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const nextKindByLead = new Map<string, string>();
  for (const t of [...tasks].filter((t) => t.status === "open").sort((a, b) => b.priority - a.priority)) {
    if (!nextKindByLead.has(t.leadId)) nextKindByLead.set(t.leadId, workKindForTask(t, leadById.get(t.leadId)));
  }

  const reassignments: Reassignment[] = [];
  const held: HeldLead[] = [];
  let consideredLeads = 0;

  // Stable order so two runs on the same data produce the same plan.
  const ordered = [...leads].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const lead of ordered) {
    if (TERMINAL_STAGES.has(lead.pipelineStage) || lead.businessStatus === "CLOSED_PERMANENTLY") continue;
    consideredLeads += 1;

    const owner = lead.assignedTo ? opById.get(lead.assignedTo) : undefined;
    const elig = eligibility(lead, owner, ctx, now);
    if (!elig) continue;

    // An away/inactive owner's live conversation may move; anyone else's may not.
    const live = isActiveConversation(lead, ctx, now);
    if (live && owner && !activeConversationsTransferable(owner)) {
      held.push({ leadId: lead.id, code: elig.code, reason: "Active conversation — continuity preserved." });
      continue;
    }

    if (!receivers.length) {
      // Promise 1 inverted: never orphan a business to satisfy a rule. It keeps
      // its current owner and the reason is recorded so the gap is visible.
      held.push({ leadId: lead.id, code: "no-available-operator", reason: "No operator is available to receive work." });
      continue;
    }

    const ranked = rank(lead, nextKindByLead.get(lead.id) ?? null, receivers, loads, localityByOperator);
    const winner = ranked.find((r) => r.op.id !== lead.assignedTo) ?? ranked[0];
    if (winner.op.id === lead.assignedTo) {
      held.push({ leadId: lead.id, code: "already-best", reason: "Current owner is still the best fit." });
      continue;
    }

    reassignments.push({
      leadId: lead.id,
      businessName: lead.businessName,
      from: lead.assignedTo,
      to: winner.op.id,
      code: elig.code,
      reason: elig.reason,
      because: winner.because,
    });

    // Reflect the move immediately so the next business sees the new balance —
    // this is what stops every lead in a batch landing on the same operator.
    const fromLoad = lead.assignedTo ? loads.get(lead.assignedTo) : undefined;
    if (fromLoad) { fromLoad.leadsOwned -= 1; fromLoad.headroom += 1; }
    const toLoad = loads.get(winner.op.id)!;
    toLoad.leadsOwned += 1;
    toLoad.dueToday += 1;
    toLoad.headroom = toLoad.capacity - toLoad.dueToday;
    const set = localityByOperator.get(winner.op.id) ?? new Set<string>();
    set.add(`${lead.city}|${lead.state}`);
    localityByOperator.set(winner.op.id, set);
  }

  // ── Levelling pass (explicit rebalance only) ───────────────────────────────
  // Repeatedly take the QUIETEST business off the operator carrying the most and
  // give it to the one carrying the least, until the gap closes. Quiet means: no
  // live conversation, not finished, not already moved above.
  if (mode === "level" && receivers.length > 1) {
    const moved = new Set(reassignments.map((r) => r.leadId));
    const ownerNow = new Map(leads.map((l) => [l.id, l.assignedTo]));
    for (const r of reassignments) ownerNow.set(r.leadId, r.to);

    const movable = ordered.filter(
      (l) =>
        !moved.has(l.id) &&
        !TERMINAL_STAGES.has(l.pipelineStage) &&
        l.businessStatus !== "CLOSED_PERMANENTLY" &&
        !isActiveConversation(l, ctx, now),
    );

    // Quietest first, so the businesses that move are the ones nobody is mid-thought on.
    const quietestFirst = [...movable].sort((a, b) => {
      const ai = idleBusinessDays(a, now) ?? Number.MAX_SAFE_INTEGER;
      const bi = idleBusinessDays(b, now) ?? Number.MAX_SAFE_INTEGER;
      return bi - ai || (a.id < b.id ? -1 : 1);
    });

    // Bounded by the number of movable businesses — it always terminates.
    for (let guard = 0; guard < quietestFirst.length; guard += 1) {
      const byLoad = [...receivers].sort((a, b) => loads.get(a.id)!.leadsOwned - loads.get(b.id)!.leadsOwned);
      const lightest = byLoad[0];
      const heaviest = byLoad[byLoad.length - 1];
      if (loads.get(heaviest.id)!.leadsOwned - loads.get(lightest.id)!.leadsOwned <= 1) break;

      const candidate = quietestFirst.find((l) => !moved.has(l.id) && ownerNow.get(l.id) === heaviest.id);
      if (!candidate) break;

      moved.add(candidate.id);
      ownerNow.set(candidate.id, lightest.id);
      reassignments.push({
        leadId: candidate.id,
        businessName: candidate.businessName,
        from: heaviest.id,
        to: lightest.id,
        code: "workload-levelling",
        reason: `Balancing the workspace — ${shortName(heaviest)} carried ${loads.get(heaviest.id)!.leadsOwned}, ${shortName(lightest)} carried ${loads.get(lightest.id)!.leadsOwned}.`,
        because: [
          `no live conversation to interrupt`,
          `quiet for ${idleBusinessDays(candidate, now) ?? "an unknown number of"} business days`,
        ],
      });
      loads.get(heaviest.id)!.leadsOwned -= 1;
      loads.get(lightest.id)!.leadsOwned += 1;
    }
  }

  return { reassignments, held, projected: [...loads.values()], consideredLeads };
}

/**
 * Who should own a brand-new business the moment it is discovered, so it never
 * lands in an unassigned pile in the first place.
 */
export function chooseOwnerForNewLead(input: {
  operators: Operator[];
  leads: Lead[];
  tasks: Task[];
  now: Date;
}): { operatorId: string; reason: string } | null {
  const receivers = input.operators.filter(canReceiveNewWork);
  if (!receivers.length) return null;
  const loads = computeWorkloads(input.operators, input.leads, input.tasks, input.now);
  const sorted = [...receivers].sort((a, b) => {
    const wa = loads.get(a.id)!, wb = loads.get(b.id)!;
    return wb.headroom - wa.headroom || wa.leadsOwned - wb.leadsOwned || (a.id < b.id ? -1 : 1);
  });
  const winner = sorted[0];
  const w = loads.get(winner.id)!;
  return { operatorId: winner.id, reason: `New business — assigned on capacity (${w.dueToday} of ${w.capacity} slots used today).` };
}
