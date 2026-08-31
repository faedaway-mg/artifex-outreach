// ─────────────────────────────────────────────────────────────────────────────
// Milestone schedule — the agreed billable breakdown of an agreement's total.
//
// Pure functions only (no DB, no network, no provider calls). Amounts are integer
// minor units (cents). The schedule is DERIVED FROM APPROVED AGREEMENT TERMS: it
// must reconcile exactly to the signed total, and a milestone is only ELIGIBLE to
// invoice when its trigger condition is met — a deposit on signature, everything
// else only on recorded acceptance/operator evidence. Signing does NOT make all
// remaining milestones immediately billable.
// ─────────────────────────────────────────────────────────────────────────────
import type { AgreementContentSnapshot } from "../types";

export type MilestoneTrigger =
  | "on_signature" // billable once the agreement is signed (the deposit)
  | "on_acceptance" // billable only when the operator records milestone acceptance
  | "manual"; // billable only by explicit operator action (no auto-eligibility)

export interface MilestoneTerm {
  key: string; // stable within an agreement (e.g. "deposit", "balance", "m1")
  label: string;
  amountCents: number;
  trigger: MilestoneTrigger;
}

export interface ScheduleReconciliation {
  ok: boolean;
  sumCents: number;
  totalCents: number;
  errors: string[];
}

/**
 * Derive the billable schedule from a frozen agreement snapshot.
 * Default (no explicit milestones on the snapshot): deposit on signature + final
 * balance on acceptance — both taken from the already-validated snapshot amounts,
 * inventing no new figures. Zero-amount legs are dropped.
 */
export function deriveSchedule(snapshot: {
  depositAmountCents: number;
  remainingBalanceCents: number;
  milestones?: MilestoneTerm[] | null;
}): MilestoneTerm[] {
  if (snapshot.milestones && snapshot.milestones.length > 0) {
    return snapshot.milestones.filter((m) => m.amountCents > 0);
  }
  const out: MilestoneTerm[] = [];
  if (snapshot.depositAmountCents > 0) {
    out.push({ key: "deposit", label: "Deposit", amountCents: snapshot.depositAmountCents, trigger: "on_signature" });
  }
  if (snapshot.remainingBalanceCents > 0) {
    out.push({ key: "balance", label: "Final balance", amountCents: snapshot.remainingBalanceCents, trigger: "on_acceptance" });
  }
  return out;
}

/** The schedule must sum EXACTLY to the contract total. */
export function reconcileSchedule(schedule: MilestoneTerm[], totalCents: number): ScheduleReconciliation {
  const errors: string[] = [];
  const sumCents = schedule.reduce((a, m) => a + m.amountCents, 0);
  const keys = schedule.map((m) => m.key);
  if (new Set(keys).size !== keys.length) errors.push("Milestone keys must be unique.");
  if (schedule.some((m) => m.amountCents <= 0)) errors.push("Every milestone amount must be a positive integer (minor units).");
  if (schedule.some((m) => !Number.isInteger(m.amountCents))) errors.push("Milestone amounts must be integer minor units (cents).");
  if (sumCents !== totalCents) errors.push(`Milestone schedule (${sumCents}) does not reconcile to the contract total (${totalCents}).`);
  return { ok: errors.length === 0, sumCents, totalCents, errors };
}

export interface EligibilityContext {
  agreementSigned: boolean;
  /** Milestone keys the operator has recorded acceptance evidence for. */
  acceptedKeys: string[];
}

/**
 * Is a milestone eligible to be INVOICED right now? Deposit needs a signed
 * agreement; acceptance/manual milestones need explicit recorded evidence. This is
 * the guard that prevents "all remaining milestones billable after the deposit".
 */
export function isMilestoneEligible(term: MilestoneTerm, ctx: EligibilityContext): boolean {
  if (!ctx.agreementSigned) return false;
  switch (term.trigger) {
    case "on_signature":
      return true;
    case "on_acceptance":
    case "manual":
      return ctx.acceptedKeys.includes(term.key);
  }
}

/** Convenience: reconcile a snapshot's derived schedule against its own total. */
export function scheduleForSnapshot(snapshot: AgreementContentSnapshot & { milestones?: MilestoneTerm[] | null }): {
  schedule: MilestoneTerm[];
  reconciliation: ScheduleReconciliation;
} {
  const schedule = deriveSchedule(snapshot);
  return { schedule, reconciliation: reconcileSchedule(schedule, snapshot.totalPriceCents) };
}
