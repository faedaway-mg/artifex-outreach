// ─────────────────────────────────────────────────────────────────────────────
// Deliberate transfers — one business or fifty, previewed before anything moves.
//
// The scheduler decides work. A manager decides RELATIONSHIPS. That is why this
// path is not gated by OPERATOR_DISTRIBUTION_ENABLED and never has been: a person
// choosing to hand a business to a colleague is the thing this system exists to
// record, not the thing it exists to prevent.
//
// What it borrows rather than rebuilds:
//   · transferLead()      — the single write path, already audited (distribute.ts)
//   · computeWorkloads()  — the same numbers the scheduler and the team page use
//   · audit_log           — already the ownership-history table; no second one
//   · isActiveConversation() — the same definition of "live" the scheduler uses
//
// The only genuinely new idea here is the PREVIEW: the manager sees each current
// owner, why they hold it, what moving it does to both people's days, and what
// they are about to interrupt — before the button says Apply. A transfer screen
// that shows only names is asking someone to sign something they cannot read.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Operator, Task, AuditEntry } from "../types";
import { computeWorkloads, isActiveConversation, isInternalLead, type Workload, type DistributionContext } from "./assignment";
import { shortName } from "./model";

/** Where a business can go. `null` means back to Unassigned. */
export type TransferTarget = string | null;

export interface TransferLine {
  leadId: string;
  businessName: string;
  from: string | null;
  fromName: string;
  to: TransferTarget;
  toName: string;
  /** Why the current owner holds it, in their own words where we have them. */
  whyOwned: string;
  /** ISO of when the current owner got it, if recorded. */
  ownedSince: string | null;
  /** True when moving this interrupts a live conversation. */
  live: boolean;
  /** Anything the manager should read before confirming. Empty is the happy path. */
  warnings: string[];
  /** Blocked lines are excluded from the apply; the reason is shown, not hidden. */
  blocked: string | null;
}

export interface WorkloadDelta {
  operatorId: string;
  name: string;
  before: Workload;
  after: Workload;
}

export interface TransferPreview {
  to: TransferTarget;
  toName: string;
  lines: TransferLine[];
  /** The lines an Apply would actually write. */
  movable: TransferLine[];
  workloads: WorkloadDelta[];
  /** Plain-language summary an operator can check against what they intended. */
  summary: string;
}

const nameOf = (ops: Operator[], id: string | null): string => {
  if (!id) return "Unassigned";
  const op = ops.find((o) => o.id === id);
  return op ? shortName(op) : id;
};

/**
 * Build the preview.
 *
 * Pure — it takes the world and returns a description of a change. The same
 * function backs the screen and the audit meta, so what a manager approved and
 * what was recorded cannot drift apart.
 */
export function previewTransfer(input: {
  leadIds: string[];
  to: TransferTarget;
  operators: Operator[];
  leads: Lead[];
  tasks: Task[];
  ctx: DistributionContext;
  history?: Map<string, AuditEntry[]>;
  now: Date;
}): TransferPreview {
  const { leadIds, to, operators, leads, tasks, ctx, now } = input;
  const byId = new Map(leads.map((l) => [l.id, l]));
  const target = to ? operators.find((o) => o.id === to) ?? null : null;
  const toName = to ? nameOf(operators, to) : "Unassigned";

  const lines: TransferLine[] = [];
  for (const id of leadIds) {
    const lead = byId.get(id);
    if (!lead) {
      lines.push({
        leadId: id, businessName: id, from: null, fromName: "—", to, toName,
        whyOwned: "—", ownedSince: null, live: false, warnings: [],
        blocked: "That business no longer exists.",
      });
      continue;
    }

    const live = isActiveConversation(lead, ctx, now);
    const warnings: string[] = [];
    let blocked: string | null = null;

    if (to && lead.assignedTo === to) blocked = `${toName} already owns this.`;
    else if (!to && !lead.assignedTo) blocked = "This is already unassigned.";
    else if (to && !target) blocked = "That operator does not exist.";
    else if (to && target && !target.active) blocked = `${toName} is inactive and cannot take work.`;

    if (live) warnings.push("Live conversation — the new owner inherits it mid-thread.");
    if (!to) warnings.push("Nobody will be accountable for this until someone claims it.");
    if (target && target.availabilityMode !== "available") {
      warnings.push(`${toName} is not taking new work (${target.availabilityMode}). A deliberate transfer still lands.`);
    }
    if (isInternalLead(lead)) warnings.push("Internal test record — it does not count toward anyone's day.");

    // Prefer what the last ownership event actually said over anything inferred.
    const last = input.history?.get(lead.id)?.[0];
    const whyOwned =
      (typeof last?.meta?.reason === "string" && last.meta.reason) ||
      lead.assignmentReason ||
      (lead.assignedTo ? "No reason was recorded." : "Never assigned.");

    lines.push({
      leadId: lead.id,
      businessName: lead.businessName,
      from: lead.assignedTo ?? null,
      fromName: nameOf(operators, lead.assignedTo ?? null),
      to, toName,
      whyOwned,
      ownedSince: lead.assignedAt ?? null,
      live,
      warnings,
      blocked,
    });
  }

  const movable = lines.filter((l) => !l.blocked);

  // Before/after uses the SAME workload computation the scheduler uses, applied to
  // a projected copy of the book. A manager should never have to trust that the
  // preview's arithmetic matches the product's.
  const before = computeWorkloads(operators, leads, tasks, now);
  const moved = new Map(movable.map((l) => [l.leadId, l.to]));
  const projected = leads.map((l) => (moved.has(l.id) ? { ...l, assignedTo: moved.get(l.id)! } : l));
  const after = computeWorkloads(operators, projected, tasks, now);

  const touched = new Set<string>();
  for (const l of movable) {
    if (l.from) touched.add(l.from);
    if (l.to) touched.add(l.to);
  }
  const workloads: WorkloadDelta[] = operators
    .filter((o) => touched.has(o.id))
    .map((o) => ({ operatorId: o.id, name: shortName(o), before: before.get(o.id)!, after: after.get(o.id)! }));

  const liveCount = movable.filter((l) => l.live).length;
  const summary = !movable.length
    ? "Nothing would move."
    : `${movable.length} ${movable.length === 1 ? "business" : "businesses"} → ${toName}` +
      (liveCount ? `, including ${liveCount} live ${liveCount === 1 ? "conversation" : "conversations"}.` : ".") +
      (lines.length - movable.length ? ` ${lines.length - movable.length} skipped.` : "");

  return { to, toName, lines, movable, workloads, summary };
}
