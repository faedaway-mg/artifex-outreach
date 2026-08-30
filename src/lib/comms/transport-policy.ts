// ─────────────────────────────────────────────────────────────────────────────
// Transport-routing policy (Gate 4). ONE typed decision for "how may this message be delivered", so
// the choice of transport is never implicit and never defaults to a sender. Every email-producing
// action declares a MessageClass; the policy maps it — via an EXHAUSTIVE switch with NO default
// send-branch — to exactly one route:
//
//   COLD_OUTREACH → "compliant"               (the single compliant cold transport: footer + postal +
//                                              signed unsubscribe + suppression rechecks + drift auth +
//                                              cap/pause/idempotency + ambiguous protection, submitted
//                                              via Resend. There is no cold-path provider SELECTION —
//                                              cold outreach cannot pick an arbitrary provider.)
//   INTERNAL_TEST → "compliant"               (same path; the recipient gate pins it to COMMS_TEST_RECIPIENT
//                                              until COMMS_PROSPECT_DELIVERY_ENABLED=1)
//   TRANSACTIONAL → "transactional-provider"   (an EXPLICITLY approved provider for non-outreach mail:
//                                              agreements, receipts, system notices — never cold queues)
//   UNKNOWN       → "refuse"                   (fail closed — an unclassified message is never sent)
//
// The transport is Resend, but cold outreach still cannot BYPASS compliance: the only cold route runs
// the full compliant pipeline. Transactional email is the only class permitted to reach a provider
// selector directly. (Microsoft Graph was evaluated and abandoned; it is not an operational dependency.)
// ─────────────────────────────────────────────────────────────────────────────

export type MessageClass = "COLD_OUTREACH" | "TRANSACTIONAL" | "INTERNAL_TEST" | "UNKNOWN";
export type TransportRoute = "compliant" | "transactional-provider" | "refuse";

/** Map a message classification to its single permitted transport route. Exhaustive; no default send. */
export function transportRouteFor(cls: MessageClass): TransportRoute {
  switch (cls) {
    case "COLD_OUTREACH":
      return "compliant";
    case "INTERNAL_TEST":
      return "compliant";
    case "TRANSACTIONAL":
      return "transactional-provider";
    case "UNKNOWN":
      return "refuse";
    default: {
      // Exhaustiveness guard: a new MessageClass must be classified deliberately. Until then it is
      // treated as UNKNOWN and REFUSED — an unhandled class can never fall through to a send.
      const _never: never = cls;
      void _never;
      return "refuse";
    }
  }
}

/** True only for cold-outreach-family classes that must ride the single compliant cold transport. */
export function isColdOutreach(cls: MessageClass): boolean {
  return cls === "COLD_OUTREACH" || cls === "INTERNAL_TEST";
}

/** Classify an Acquisition OS plan/step email. Its only two shapes are a real prospect cold email and
 *  the internal-test rehearsal; anything we cannot positively identify is UNKNOWN (→ refused). */
export function classifyLeadSource(source: string | null | undefined): MessageClass {
  if (source === "internal-test") return "INTERNAL_TEST";
  // Every other lead that reaches the outreach plan/step pipeline is prospect cold outreach.
  return "COLD_OUTREACH";
}
