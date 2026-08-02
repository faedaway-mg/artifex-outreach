"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Operator-facing distribution and team controls.
//
// Everything here changes the world and everything here is a deliberate act,
// never background behaviour: rebalancing the workspace, handing businesses to a
// colleague, adding a person to the team, standing at someone else's desk.
// Automation maintains; people decide.
//
// Two rules hold across every action below:
//
//   1. THE CAPABILITY IS CHECKED ON THE SERVER. A server action is a public HTTP
//      endpoint. A hidden button is a courtesy; `require()` is the boundary.
//   2. THE ACTOR IS THE REAL PERSON. currentActor() ignores impersonation on
//      purpose, so a manager working inside Alex's queue is recorded as the
//      manager — with `onBehalfOf` naming whose desk they were at.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import {
  updateOperator, appendAudit, getOperator, listOperators, listLeads, allTasks,
  allPlans, allMeetings, insertOperatorIfAbsent, auditForTarget,
} from "../repo";
import { currentActor } from "../auth";
import { beginImpersonation, endImpersonation } from "../impersonation";
import { runDistribution, transferLead, distributionEnabled } from "./distribute";
import { AVAILABILITY_MODES, normalizeOperator, initialsOf, type NewOperatorInput } from "./model";
import { canImpersonate, ROLES, ROLE_LABEL, type Role } from "./roles";
import { previewTransfer, type TransferPreview, type TransferTarget } from "./transfer";
import { require as requireCapability, session } from "./session";
import type { AvailabilityMode, AuditEntry, Operator } from "../types";
import type { DistributionResult } from "./distribute";

function refresh() {
  revalidatePath("/");
  revalidatePath("/team");
  revalidatePath("/pipeline");
}

/** The world, loaded once, for anything that has to reason about workload. */
async function world() {
  const [operators, leads, tasks, plans, meetings] = await Promise.all([
    listOperators(), listLeads(), allTasks(), allPlans(), allMeetings(),
  ]);
  return { operators, leads, tasks, ctx: { plans, meetings } };
}

// ── Rebalancing ──────────────────────────────────────────────────────────────

/**
 * Preview the rebalance. Same computation as the apply, with the writes withheld,
 * so what an operator approves is exactly what runs.
 */
export async function previewRebalanceAction(): Promise<DistributionResult> {
  await requireCapability("rebalance");
  return runDistribution({ mode: "level", apply: false, actor: currentActor() });
}

/**
 * Apply the rebalance. Refuses while the distribution policy gate is off — the
 * preview stays available so the plan can be read and judged, but no path in the
 * product can move a real book of business until that is turned on deliberately.
 */
export async function applyRebalanceAction(): Promise<DistributionResult> {
  await requireCapability("rebalance");
  if (!distributionEnabled()) {
    return { ...(await runDistribution({ mode: "level", apply: false, actor: currentActor() })), applied: false, written: [] };
  }
  const result = await runDistribution({ mode: "level", apply: true, actor: currentActor() });
  refresh();
  return result;
}

// ── Availability and capacity ────────────────────────────────────────────────

/**
 * Change an operator's availability.
 *
 * Engineering focus is the interesting one: it stops new work arriving and lets
 * quiet businesses move on, while every live conversation stays put. Turning it
 * off needs no migration — the next distribution pass simply sees an available
 * operator with headroom and starts feeding them again.
 *
 * Anyone may set their OWN mode. Setting someone else's is a management act.
 */
export async function setAvailabilityAction(operatorId: string, mode: string): Promise<void> {
  if (!(AVAILABILITY_MODES as readonly string[]).includes(mode)) return;
  const s = await session();
  if (operatorId !== s.actorId && !s.can.manageOperators) {
    throw new Error("Not permitted: changing another operator's availability requires a manager role.");
  }
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { availabilityMode: mode as AvailabilityMode, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.availability",
    actor: s.actorId,
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.availabilityMode, to: mode, ...(s.impersonating ? { onBehalfOf: s.viewingId } : {}) },
    ip: null,
  });
  refresh();
}

export async function setCapacityAction(operatorId: string, capacity: number): Promise<void> {
  const s = await session();
  if (operatorId !== s.actorId && !s.can.manageOperators) {
    throw new Error("Not permitted: changing another operator's capacity requires a manager role.");
  }
  const value = Math.max(0, Math.min(50, Math.round(capacity)));
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { dailyCapacity: value, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.capacity",
    actor: s.actorId,
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.dailyCapacity, to: value, ...(s.impersonating ? { onBehalfOf: s.viewingId } : {}) },
    ip: null,
  });
  refresh();
}

// ── Transfers ────────────────────────────────────────────────────────────────

/** Hand one business to a colleague on purpose. The only path that may move a live conversation. */
export async function transferLeadAction(leadId: string, toOperatorId: string, reason: string): Promise<void> {
  const s = await requireCapability("transferWork");
  const trimmed = reason.trim() || "Manual transfer.";
  await transferLead({
    leadId, toOperatorId, actor: s.actorId, reason: trimmed,
    onBehalfOf: s.impersonating ? s.viewingId : null,
  });
  revalidatePath(`/leads/${leadId}`);
  refresh();
}

/**
 * What a bulk transfer would do — every current owner, why they hold it, what it
 * does to both people's days, and what it interrupts. Writes nothing.
 */
export async function previewTransferAction(leadIds: string[], to: TransferTarget): Promise<TransferPreview> {
  await requireCapability("transferWork");
  const { operators, leads, tasks, ctx } = await world();
  const history = new Map<string, AuditEntry[]>();
  for (const id of leadIds.slice(0, 200)) history.set(id, await auditForTarget("lead", id));
  return previewTransfer({ leadIds, to, operators, leads, tasks, ctx, history, now: new Date() });
}

/**
 * Apply a bulk transfer.
 *
 * Re-previews server-side and moves only what the fresh preview says is movable,
 * so a stale screen cannot write a decision the manager could not have seen. Each
 * business is still its own write and its own audit row — a bulk action is many
 * transfers, not a new kind of event, and the timeline should read that way.
 */
export async function applyTransferAction(
  leadIds: string[],
  to: TransferTarget,
  reason: string,
): Promise<{ moved: number; skipped: number; preview: TransferPreview }> {
  const s = await requireCapability("transferWork");
  const trimmed = reason.trim() || (to ? "Manual transfer." : "Released to Unassigned.");
  const { operators, leads, tasks, ctx } = await world();
  const preview = previewTransfer({ leadIds, to, operators, leads, tasks, ctx, now: new Date() });

  let moved = 0;
  for (const line of preview.movable) {
    const r = await transferLead({
      leadId: line.leadId, toOperatorId: to, actor: s.actorId, reason: trimmed,
      onBehalfOf: s.impersonating ? s.viewingId : null,
    });
    if (r.ok) moved += 1;
    revalidatePath(`/leads/${line.leadId}`);
  }
  refresh();
  return { moved, skipped: preview.lines.length - moved, preview };
}

/** Take accountability for an unowned business. */
export async function claimLeadAction(leadId: string, reason?: string): Promise<void> {
  const s = await session();
  // Claiming for yourself needs no authority — it is the opposite of a land grab,
  // it is volunteering. Claiming FOR someone else is a transfer.
  await transferLead({
    leadId,
    toOperatorId: s.viewingId,
    actor: s.actorId,
    reason: (reason ?? "").trim() || "Claimed — taking accountability for this business.",
    onBehalfOf: s.impersonating ? s.viewingId : null,
  });
  revalidatePath(`/leads/${leadId}`);
  refresh();
}

/** Put a business back in the unassigned pile, on purpose and on the record. */
export async function releaseLeadAction(leadId: string, reason: string): Promise<void> {
  const s = await requireCapability("transferWork");
  await transferLead({
    leadId, toOperatorId: null, actor: s.actorId,
    reason: reason.trim() || "Released to Unassigned.",
    onBehalfOf: s.impersonating ? s.viewingId : null,
  });
  revalidatePath(`/leads/${leadId}`);
  refresh();
}

// ── Team management ──────────────────────────────────────────────────────────

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

/**
 * Add a person to the team.
 *
 * NO MIGRATION. Every field an operator has — availability, capacity, preferred
 * work kinds, timezone, role, active — has existed on `users` since 0018. Adding
 * the third outreach operator is a row, exactly as the model promised.
 *
 * The id is a slug of the name and MUST NOT contain a dot: it becomes the subject
 * of the session token, whose payload is `${subject}.${issuedAt}`.
 */
export async function createOperatorAction(input: NewOperatorInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const s = await requireCapability("createOperator");

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) return { ok: false, error: "A name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "A valid email address is required." };

  const id = slug(name);
  if (!id) return { ok: false, error: "That name does not produce a usable id." };

  const existing = await listOperators();
  if (existing.some((o) => o.id === id)) return { ok: false, error: `An operator id "${id}" already exists.` };
  if (existing.some((o) => o.email.toLowerCase() === email)) return { ok: false, error: "That email is already in use." };

  const role: Role = (ROLES as readonly string[]).includes(input.role) ? (input.role as Role) : "operator";
  const now = new Date().toISOString();
  const operator: Operator = normalizeOperator({
    id, name, email, role,
    initials: initialsOf({ name, initials: input.initials ?? "" }),
    availabilityMode: (AVAILABILITY_MODES as readonly string[]).includes(input.availabilityMode ?? "")
      ? (input.availabilityMode as AvailabilityMode) : "available",
    dailyCapacity: Math.max(0, Math.min(50, Math.round(input.dailyCapacity ?? 8))),
    preferredWorkKinds: input.preferredWorkKinds ?? [],
    timezone: input.timezone?.trim() || "America/Los_Angeles",
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  const { created } = await insertOperatorIfAbsent(operator);
  if (!created) return { ok: false, error: "That operator already exists." };

  await appendAudit({
    action: "operator.created",
    actor: s.actorId,
    targetType: "operator",
    targetId: id,
    meta: { name, email, role, dailyCapacity: operator.dailyCapacity, timezone: operator.timezone },
    ip: null,
  });
  refresh();
  return { ok: true, id };
}

/** Change what an operator is allowed to decide. */
export async function setRoleAction(operatorId: string, role: string): Promise<void> {
  const s = await requireCapability("manageOperators");
  if (!(ROLES as readonly string[]).includes(role)) return;
  if (operatorId === s.actorId) throw new Error("Not permitted: you cannot change your own role.");
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { role, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.role",
    actor: s.actorId,
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.role, to: role, label: ROLE_LABEL[role as Role] },
    ip: null,
  });
  refresh();
}

/**
 * Retire or restore an operator.
 *
 * Deactivating is NOT deletion and never will be: the audit log is full of things
 * this person did, and a row that disappears takes the explanation of a year of
 * ownership with it. An inactive operator stops receiving work; their history
 * stays readable.
 */
export async function setOperatorActiveAction(operatorId: string, active: boolean): Promise<void> {
  const s = await requireCapability("manageOperators");
  if (operatorId === s.actorId) throw new Error("Not permitted: you cannot deactivate yourself.");
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { active, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.active",
    actor: s.actorId,
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.active, to: active },
    ip: null,
  });
  refresh();
}

export async function setTimezoneAction(operatorId: string, timezone: string): Promise<void> {
  const s = await session();
  if (operatorId !== s.actorId && !s.can.manageOperators) {
    throw new Error("Not permitted: changing another operator's timezone requires a manager role.");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { return; }
  const before = await getOperator(operatorId);
  if (!before) return;
  await updateOperator(operatorId, { timezone, updatedAt: new Date().toISOString() });
  await appendAudit({
    action: "operator.timezone",
    actor: s.actorId,
    targetType: "operator",
    targetId: operatorId,
    meta: { from: before.timezone, to: timezone },
    ip: null,
  });
  refresh();
}

// ── Impersonation ────────────────────────────────────────────────────────────

/**
 * Stand at another operator's desk.
 *
 * Not a transfer of ownership and not a change of session: the manager stays
 * signed in as themselves. What moves is only what they are LOOKING at.
 */
export async function beginImpersonationAction(targetId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await session();
  const target = await getOperator(targetId);
  const verdict = canImpersonate(s.actor, target);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  beginImpersonation(targetId);
  await appendAudit({
    action: "operator.impersonation_started",
    actor: s.actorId,
    targetType: "operator",
    targetId,
    meta: { manager: s.actorId, viewing: targetId, reason: verdict.reason },
    ip: null,
  });
  refresh();
  return { ok: true };
}

/** Return to your own workspace, and record how long the visit lasted. */
export async function endImpersonationAction(): Promise<void> {
  const s = await session();
  if (s.impersonating) {
    const started = s.impersonationStartedAt;
    await appendAudit({
      action: "operator.impersonation_ended",
      actor: s.actorId,
      targetType: "operator",
      targetId: s.viewingId,
      meta: {
        manager: s.actorId,
        viewing: s.viewingId,
        startedAt: started,
        durationMinutes: started ? Math.round((Date.now() - Date.parse(started)) / 60_000) : null,
      },
      ip: null,
    });
  }
  endImpersonation();
  refresh();
}
