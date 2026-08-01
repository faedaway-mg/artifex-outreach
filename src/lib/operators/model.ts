// ─────────────────────────────────────────────────────────────────────────────
// The operator model.
//
// An operator is an ACCOUNTABLE PARTY, not a login. The system's promise is:
// every qualified business always has exactly one operator answerable for it,
// while duplicate outreach is impossible and relationship continuity is never
// broken by automation.
//
// Ownership exists to ensure accountability. Not exclusivity.
//
// This module is pure data + naming. It reads nothing and writes nothing, so it
// is safe to import from anywhere (edge, client, tests).
// ─────────────────────────────────────────────────────────────────────────────
import type { Operator, AvailabilityMode } from "../types";
import { AVAILABILITY_MODES } from "../types";

export { AVAILABILITY_MODES };
export type { AvailabilityMode };

/** Fallback owner for every row written before operators existed. */
export const LEGACY_OPERATOR_ID = "jordan";

/**
 * The operators the workspace starts with. This is a SEED, not a special case:
 * the distributor, the queue, and the metrics read the operators table and would
 * behave identically with two operators or twenty. Adding a third person is a
 * row, not a code change.
 */
export const SEED_OPERATORS: Array<Pick<Operator, "id" | "name" | "email" | "role" | "initials" | "dailyCapacity">> = [
  { id: "jordan", name: "Jordan Jackson", email: "jordan@artifexlabs.tech", role: "Founder / Operator", initials: "JJ", dailyCapacity: 8 },
  { id: "alex", name: "Alex", email: "alex@artifexlabs.tech", role: "Operator", initials: "AX", dailyCapacity: 8 },
];

/** Two-letter monogram, derived when none was stored. */
export function initialsOf(op: Pick<Operator, "name" | "initials">): string {
  if (op.initials?.trim()) return op.initials.trim().slice(0, 2).toUpperCase();
  const parts = op.name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Short label for the queue switcher and audit reasons. */
export function shortName(op: Pick<Operator, "name">): string {
  return op.name.trim().split(/\s+/)[0] || op.name;
}

export const AVAILABILITY_LABEL: Record<AvailabilityMode, string> = {
  available: "Available",
  engineering: "Engineering focus",
  away: "Away",
};

export const AVAILABILITY_MEANING: Record<AvailabilityMode, string> = {
  available: "Receiving new businesses as capacity allows.",
  engineering: "No new businesses. Active conversations stay; quiet work is redistributed.",
  away: "No new businesses. Even active conversations can be covered by someone else.",
};

/** Only an available, active operator may receive NEW work. */
export function canReceiveNewWork(op: Operator): boolean {
  return op.active && op.availabilityMode === "available";
}

/**
 * Whether an operator's ACTIVE conversations may be moved without an explicit
 * manual transfer. Engineering focus deliberately protects them — the whole
 * point is that a live relationship survives a build sprint.
 */
export function activeConversationsTransferable(op: Operator): boolean {
  return !op.active || op.availabilityMode === "away";
}

/** Fill in the columns 0018 added for rows that predate them. */
export function normalizeOperator(row: Partial<Operator> & Pick<Operator, "id" | "name" | "email">): Operator {
  const now = new Date().toISOString();
  return {
    role: "operator",
    avatarUrl: null,
    active: true,
    availabilityMode: "available",
    preferredWorkKinds: [],
    dailyCapacity: 8,
    timezone: "America/Los_Angeles",
    lastActiveAt: null,
    createdAt: now,
    updatedAt: now,
    ...row,
    initials: initialsOf({ name: row.name, initials: row.initials ?? "" }),
  } as Operator;
}
