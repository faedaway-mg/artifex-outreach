"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Operator-facing distribution controls.
//
// Two of these change the world and both are deliberate acts, never background
// behaviour: rebalancing the workspace, and handing one business to a colleague.
// Automation maintains; people decide.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { updateOperator, appendAudit, getOperator } from "../repo";
import { currentActor } from "../auth";
import { runDistribution, transferLead, distributionEnabled } from "./distribute";
import { AVAILABILITY_MODES } from "./model";
import type { AvailabilityMode } from "../types";
import type { DistributionResult } from "./distribute";

function refresh() {
  revalidatePath("/");
  revalidatePath("/team");
  revalidatePath("/pipeline");
}

/**
 * Preview the rebalance. Same computation as the apply, with the writes withheld,
 * so what an operator approves is exactly what runs.
 */
export async function previewRebalanceAction(): Promise<DistributionResult> {
  return runDistribution({ mode: "level", apply: false, actor: currentActor() });
}

/**
 * Apply the rebalance. Refuses while the distribution policy gate is off — the
 * preview stays available so the plan can be read and judged, but no path in the
 * product can move a real book of business until that is turned on deliberately.
 */
export async function applyRebalanceAction(): Promise<DistributionResult> {
  if (!distributionEnabled()) {
    return { ...(await runDistribution({ mode: "level", apply: false, actor: currentActor() })), applied: false, written: [] };
  }
  const result = await runDistribution({ mode: "level", apply: true, actor: currentActor() });
  refresh();
  return result;
}

/**
 * Change an operator's availability.
 *
 * Engineering focus is the interesting one: it stops new work arriving and lets
 * quiet businesses move on, while every live conversation stays put. Turning it
 * off needs no migration — the next distribution pass simply sees an available
 * operator with headroom and starts feeding them again.
 */
export async function setAvailabilityAction(operatorId: string, mode: string): Promise<void> {
  if (!(AVAILABILITY_MODES as readonly string[]).includes(mode)) return;
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { availabilityMode: mode as AvailabilityMode, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.availability",
    actor: currentActor(),
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.availabilityMode, to: mode },
    ip: null,
  });
  refresh();
}

export async function setCapacityAction(operatorId: string, capacity: number): Promise<void> {
  const value = Math.max(0, Math.min(50, Math.round(capacity)));
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { dailyCapacity: value, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.capacity",
    actor: currentActor(),
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.dailyCapacity, to: value },
    ip: null,
  });
  refresh();
}

/** Hand one business to a colleague on purpose. The only path that may move a live conversation. */
export async function transferLeadAction(leadId: string, toOperatorId: string, reason: string): Promise<void> {
  const trimmed = reason.trim() || "Manual transfer.";
  await transferLead({ leadId, toOperatorId, actor: currentActor(), reason: trimmed });
  revalidatePath(`/leads/${leadId}`);
  refresh();
}
