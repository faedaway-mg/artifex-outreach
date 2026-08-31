// ─────────────────────────────────────────────────────────────────────────────
// Closing authorization — a bounded capability table for money/legal actions.
//
// Separate from operators/roles.ts (which governs outreach team decisions): the
// closing lane's decisions — approving contracts, issuing/voiding invoices,
// activating subscriptions, refunds, kickoff — are a distinct accountability
// domain. Same Role vocabulary, its own table. Enforced SERVER-SIDE: the actor's
// role is resolved from the persisted operator record, never from client input.
//
// TODAY these are founder/admin-only: money and contract decisions are the owner's.
// The table is data (not scattered ifs) so widening it later is a one-line change,
// and it becomes a security boundary unchanged the day per-operator auth exists.
// ─────────────────────────────────────────────────────────────────────────────
import { roleOf, type Role } from "../operators/roles";
import { getOperator } from "../repo";
import type { Operator } from "../types";

export const CLOSING_CAPABILITIES = [
  "editAgreement",
  "approveAgreement",
  "sendSignature",
  "createInvoice",
  "issueInvoice",
  "voidInvoice",
  "activateSubscription",
  "cancelSubscription",
  "reconcile",
  "refund",
  "kickoff",
] as const;
export type ClosingCapability = (typeof CLOSING_CAPABILITIES)[number];

const ALL: Record<ClosingCapability, boolean> = Object.fromEntries(
  CLOSING_CAPABILITIES.map((c) => [c, true]),
) as Record<ClosingCapability, boolean>;
const NONE: Record<ClosingCapability, boolean> = Object.fromEntries(
  CLOSING_CAPABILITIES.map((c) => [c, false]),
) as Record<ClosingCapability, boolean>;

// Money + legal authority is the owner's today. Anyone else signed in can view but
// cannot approve contracts or move money. Widen deliberately, per real need.
export const CLOSING_CAPS: Record<Role, Record<ClosingCapability, boolean>> = {
  founder: ALL,
  admin: ALL,
  engineering: NONE,
  head_of_outreach: NONE,
  operator: NONE,
};

export function closingCan(role: Role, capability: ClosingCapability): boolean {
  return CLOSING_CAPS[role]?.[capability] ?? false;
}

export class ClosingAuthorizationError extends Error {
  constructor(public role: Role, public capability: ClosingCapability) {
    super(`Role '${role}' is not authorized to ${capability}.`);
    this.name = "ClosingAuthorizationError";
  }
}

/** Throwing form for server actions. */
export function authorizeClosing(role: Role, capability: ClosingCapability): void {
  if (!closingCan(role, capability)) throw new ClosingAuthorizationError(role, capability);
}

/** Resolve a role from an operator record (accountability + provenance). */
export function roleForOperator(op: Pick<Operator, "role"> | null | undefined): Role {
  return roleOf(op);
}

/**
 * Server-side resolve of an actor id → role, read from the persisted operator.
 * Unknown/absent operators normalise to the least-privileged role.
 */
export async function resolveActorRole(actorId: string): Promise<Role> {
  const op = await getOperator(actorId);
  return roleOf(op ?? null);
}
