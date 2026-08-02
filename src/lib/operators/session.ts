// ─────────────────────────────────────────────────────────────────────────────
// Who is here, whose desk they are sitting at, and what they may do.
//
// One function, because every page and every action needs the same three answers
// and any place that computes them differently is a place where the banner says
// one thing and the audit log says another.
// ─────────────────────────────────────────────────────────────────────────────
import { getOperator, listOperators } from "../repo";
import { viewerContext, currentActor, currentOperatorId } from "../auth";
import { capabilitiesOf, roleOf, type Capabilities, type Role } from "./roles";
import type { Operator } from "../types";

export interface Session {
  /** The human at the keyboard. Every write is attributed to this operator. */
  actor: Operator | null;
  actorId: string;
  role: Role;
  /** Capabilities are ALWAYS the real person's. Impersonation never grants any. */
  can: Capabilities;
  /** Whose workspace is on screen. */
  viewing: Operator | null;
  viewingId: string;
  impersonating: boolean;
  impersonationStartedAt: string | null;
}

export async function session(): Promise<Session> {
  const ctx = viewerContext();
  const actorId = currentActor();
  const viewingId = currentOperatorId();
  const [actor, viewing] = await Promise.all([
    actorId === "system" ? Promise.resolve(null) : getOperator(actorId),
    getOperator(viewingId),
  ]);
  return {
    actor: actor ?? null,
    actorId,
    role: roleOf(actor),
    can: capabilitiesOf(actor),
    viewing: viewing ?? null,
    viewingId,
    impersonating: ctx.impersonating,
    impersonationStartedAt: ctx.startedAt,
  };
}

/**
 * Fail closed.
 *
 * Server actions are a public HTTP surface — a disabled button is a hint, not a
 * boundary — so every mutating action asks for its capability here and throws
 * rather than returning a soft "no". A silent no-op would leave a manager
 * believing work moved when it did not.
 */
export async function require(capability: keyof Capabilities): Promise<Session> {
  const s = await session();
  if (!s.can[capability]) {
    throw new Error(`Not permitted: ${capability} requires a role you do not have.`);
  }
  return s;
}

/** Operators the current person may hand work to. */
export async function assignableOperators(): Promise<Operator[]> {
  return (await listOperators()).filter((o) => o.active);
}
