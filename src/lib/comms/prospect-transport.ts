// ─────────────────────────────────────────────────────────────────────────────
// PROSPECT-OUTBOUND TRANSPORT POLICY — the hard, application-level boundary that
// separates the three mail functions of Acquisition OS:
//
//   • PROSPECT_OUTBOUND (cold acquisition email: first-touch, follow-ups, scheduled,
//     lead-sprint, autonomous sends) → the Google Workspace lanes, and ONLY those.
//   • TRANSACTIONAL (receipts, checkout confirmations, opted-in/customer lifecycle) →
//     Resend, where already appropriate.
//   • HUMAN_MAILBOX (hello@artifexlabs.tech on Microsoft 365 / Outlook) → preserved,
//     never a prospect-send transport.
//
// THE NON-NEGOTIABLE RULE: a prospect-outbound message may NEVER be delivered via the
// transactional Resend transport. If a prospect send would resolve to Resend, we FAIL
// CLOSED with the exact internal reason below and send nothing — there is no silent
// fallback. This module is the single source of truth for that decision so the rule
// can be unit-tested in isolation and cannot drift into an implicit default.
// ─────────────────────────────────────────────────────────────────────────────
import { googleTransportConfigured } from "./google-workspace/config";

/** The single canonical prospect-outbound transport. Cold acquisition mail rides ONLY this. */
export const PROSPECT_TRANSPORT = "google-workspace" as const;
export type ProspectTransport = typeof PROSPECT_TRANSPORT;

/** The EXACT internal reason surfaced when a prospect send would resolve to Resend. Fail-closed. */
export const RESEND_PROSPECT_REJECTION = "Prospect outreach cannot use transactional Resend transport.";

/** True when a transport/provider name denotes the transactional Resend provider (any casing). */
export function isResendTransport(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "resend";
}

export type ProspectTransportDecision =
  | { ok: true; transport: ProspectTransport }
  | { ok: false; errorCode: string; reason: string };

/**
 * Decide how a prospect-outbound (cold) message may be delivered. NEVER returns Resend.
 * Returns the Google Workspace lane transport when it is configured; otherwise fails closed
 * (there is deliberately no Resend branch — the transactional provider can never carry cold mail).
 */
export function resolveProspectTransport(env: NodeJS.ProcessEnv = process.env): ProspectTransportDecision {
  if (googleTransportConfigured(env)) {
    return { ok: true, transport: PROSPECT_TRANSPORT };
  }
  // Google (the ONLY cold transport) is not configured. We do NOT fall back to Resend.
  return {
    ok: false,
    errorCode: "prospect-transport-unconfigured",
    reason:
      "Prospect outreach transport (Google Workspace lanes) is not configured — refusing to send. " +
      RESEND_PROSPECT_REJECTION,
  };
}

/**
 * Defense-in-depth guard used right before a cold message is handed to a provider: assert the
 * resolved transport is not Resend. Returns the fail-closed reason when it IS Resend, else null.
 */
export function refuseResendForProspect(transportName: string | null | undefined):
  | { errorCode: string; reason: string }
  | null {
  if (isResendTransport(transportName)) {
    return { errorCode: "prospect-transport-forbidden", reason: RESEND_PROSPECT_REJECTION };
  }
  return null;
}
