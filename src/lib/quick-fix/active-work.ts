// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL ACTIVE-WORK PREDICATE — the single source of truth for "is this lead
// CURRENT operator work?" across every operational surface (Quick-Cash home feed,
// Ready-to-Sell counts, any queue badge).
//
// DOCTRINE (why this exists): the Quick-Cash board is inventory-derived — any lead
// with stored business_intelligence produces a sellable offer and would otherwise
// surface forever. Historical existence is NOT active work. A lead is ACTIVE only
// when it has a COMMITTED current next action:
//   • a non-terminal acquisition plan (approved / pending / prepared — a real,
//     operator-facing next step), OR
//   • a committed Quick-Cash offer in the store (APPROVED_NOT_SENT / SCHEDULED /
//     SENT / REPLIED / purchased).
// Stored BI, an old route, an old analysis, a retired plan, a NONE/NEEDS_REVIEW
// offer, or raw inventory NEVER counts as active. Inventory stays discoverable for
// requalification (the inventory funnel, /revenue/quick-cash) — it just does not
// populate the active board until it earns a current action again.
// ─────────────────────────────────────────────────────────────────────────────
import { allPlans } from "../repo";
import { listOffers } from "./store";

/** Plan approval states that represent a REAL current next action (not terminal/draft). */
const ACTIVE_PLAN_APPROVAL = new Set(["approved", "pending", "prepared"]);
/** Plan states that are terminal — never active regardless of approval field. */
const TERMINAL_PLAN_STATUS = new Set(["retired", "archived", "lost", "cancelled", "done", "rejected"]);
/** Store outreach states that represent a committed outbound action already taken/queued. */
const COMMITTED_OFFER_STATES = new Set(["APPROVED_NOT_SENT", "SCHEDULED", "SENT", "REPLIED"]);

export interface ActiveWorkContext {
  /** Lead IDs with a legitimate current next action. */
  leadIds: Set<string>;
  /** leadId → short reason (for audit/debug/UI provenance). */
  reasons: Map<string, string>;
}

export async function loadActiveWorkContext(): Promise<ActiveWorkContext> {
  const leadIds = new Set<string>();
  const reasons = new Map<string, string>();

  for (const p of (await allPlans()) as any[]) {
    const approval = String(p.approvalStatus ?? "");
    const status = String(p.status ?? "");
    if (ACTIVE_PLAN_APPROVAL.has(approval) && !TERMINAL_PLAN_STATUS.has(status) && !TERMINAL_PLAN_STATUS.has(approval)) {
      leadIds.add(p.leadId);
      reasons.set(p.leadId, `plan:${approval}`);
    }
  }

  for (const o of (await listOffers()) as any[]) {
    const st = o.outreachState as string | undefined;
    const committed = (st != null && COMMITTED_OFFER_STATES.has(st)) || !!o.purchasedAt;
    if (committed) {
      leadIds.add(o.leadId);
      if (!reasons.has(o.leadId)) reasons.set(o.leadId, `offer:${st ?? "purchased"}`);
    }
  }

  return { leadIds, reasons };
}

/** True iff the lead is CURRENT operator work under today's doctrine. */
export function isActiveOperatorWork(leadId: string, ctx: ActiveWorkContext): boolean {
  return ctx.leadIds.has(leadId);
}
