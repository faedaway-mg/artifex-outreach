// ─────────────────────────────────────────────────────────────────────────────
// Esign signing MODE (Gate 2). An agreement is either a TEST rehearsal document or a
// PRODUCTION legally-binding one. The mode is derived SERVER-SIDE, frozen with the
// agreement, and IMMUTABLE after sending. It is never taken from client input.
//
// Fail closed: anything short of an explicit, gated, owner-authorized production
// signing resolves to "test". A test-mode agreement can never unlock live payment
// (enforced by the billing firewall), and a production agreement can never be
// downgraded to test after approval.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement, AgreementStatus } from "../types";

export type EsignMode = "test" | "production";

/** SignWell `test_mode` boolean that MUST accompany each mode. */
export function signwellTestModeFor(mode: EsignMode): boolean {
  return mode !== "production";
}

/** Name of the server-side gate that must be ON for production signing to be possible. */
export const PRODUCTION_SIGNING_GATE_ENV = "PRODUCTION_SIGNING_ENABLED";

export interface DeriveModeInput {
  /** Owner explicitly authorized PRODUCTION signing for THIS agreement (server-verified). */
  ownerAuthorizedProduction: boolean;
  /** Value of the server-side production-signing gate (process.env, read by the caller). */
  productionGateEnv?: string | undefined;
  /** NODE_ENV — production signing is only derivable in a production runtime. */
  nodeEnv?: string | undefined;
}

function envOn(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "on";
}

/**
 * Resolve the signing mode SERVER-SIDE. Returns "production" ONLY when every condition
 * holds: the runtime is production, the production-signing gate is ON, and the owner
 * explicitly authorized production for this agreement. Otherwise "test" (fail closed).
 */
export function deriveEsignMode(input: DeriveModeInput): EsignMode {
  const gateOn = envOn(input.productionGateEnv);
  const isProdRuntime = (input.nodeEnv ?? "development") === "production";
  if (input.ownerAuthorizedProduction && gateOn && isProdRuntime) return "production";
  return "test";
}

/** Convenience wrapper that reads the gate + NODE_ENV from process.env. */
export function deriveEsignModeFromEnv(ownerAuthorizedProduction: boolean): EsignMode {
  return deriveEsignMode({
    ownerAuthorizedProduction,
    productionGateEnv: process.env[PRODUCTION_SIGNING_GATE_ENV],
    nodeEnv: process.env.NODE_ENV,
  });
}

// Statuses at which the mode is still settable (before anything leaves for signature).
const PRE_SEND_STATUSES: AgreementStatus[] = ["draft", "generated", "approved"];

/** The mode may only be set/changed before the agreement is sent for signature. */
export function canSetEsignMode(status: AgreementStatus): boolean {
  return PRE_SEND_STATUSES.includes(status);
}

export class EsignModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsignModeError";
  }
}

/**
 * Guard a mode assignment. Throws if the agreement is already past pre-send, or if the
 * change would flip an already-set mode (production↔test) after approval — both are
 * forbidden. Setting the same value again is a no-op.
 */
export function assertModeAssignable(agreement: Pick<Agreement, "status"> & { esignMode?: EsignMode | null }, next: EsignMode): void {
  const current = agreement.esignMode ?? null;
  if (current === next) return;
  if (current != null) {
    // A mode was already frozen. Never allow test→production or production→test.
    throw new EsignModeError(`esign mode is already '${current}' and cannot be changed to '${next}' (immutable after it is set).`);
  }
  if (!canSetEsignMode(agreement.status)) {
    throw new EsignModeError(`esign mode cannot be set once the agreement is '${agreement.status}' (past pre-send).`);
  }
}

/**
 * The SignWell document's `test_mode` MUST agree with the persisted mode. Used both at
 * send time and in the webhook — a mismatch is rejected (never processed). Returns null
 * when consistent, or a reason string when not.
 */
export function modeMismatchReason(persistedMode: EsignMode, signwellTestMode: boolean): string | null {
  const expected = signwellTestModeFor(persistedMode);
  if (expected !== signwellTestMode) {
    return `SignWell test_mode=${signwellTestMode} disagrees with persisted esign mode '${persistedMode}' (expected test_mode=${expected}).`;
  }
  return null;
}
