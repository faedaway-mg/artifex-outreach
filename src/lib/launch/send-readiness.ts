// ─────────────────────────────────────────────────────────────────────────────
// SEND-INFRASTRUCTURE READINESS AUDIT — a PURE-ish, READ-ONLY report of the send
// stack's CONFIGURATION as BOOLEAN / enum FACTS ONLY. It never sends, never charges,
// and — critically — NEVER returns a secret value, the configured From identity
// string, or the whitelisted test-recipient address. Presence is reported as a
// boolean derived from `!!(process.env.X || "").trim()`; the actual value never
// leaves this module.
//
// Provider = Resend (the configured transport for cold outreach). Reply-To mirrors
// From by design (dispatch.ts sets replyTo = addressOnly(from)). The no-send-by-
// default gates (COMMS_PROSPECT_DELIVERY_ENABLED / COMMS_TEST_RECIPIENT /
// OUTREACH_SENDING_ENABLED / COMMS_AUTOSEND_ENABLED) are surfaced as booleans so the
// operator can SEE the send posture without any address or key being observable.
// ─────────────────────────────────────────────────────────────────────────────
import type { Settings } from "@/lib/types";
import { GLOBAL_DAILY_CAP } from "@/lib/acquisition/daily-cap";

/** A permissive env view: only presence matters, and tests inject partial objects. */
export type EnvLike = Record<string, string | undefined>;

/** The safe, observable shape of a settings read (only the field the audit needs). */
export interface AuditSettingsInput {
  contactEmail?: string | null;
  businessAddress?: string | null;
}

/**
 * The audit report — BOOLEAN / enum / number facts ONLY. There is deliberately no
 * field that can carry a secret, the From address string, or the test-recipient
 * address: every configuration presence is a boolean.
 */
export interface SendInfrastructureAudit {
  provider: "resend";
  /** RESEND_API_KEY present → the transport CAN send (subject to the gates below). */
  sendConfigured: boolean;
  /** A From identity resolves (RESEND_FROM present OR settings.contactEmail present). */
  fromIdentityConfigured: boolean;
  /** Reply-To behaviour is fixed by construction: it mirrors the From address. */
  replyToBehavior: "mirrors-from";
  /** COMMS_UNSUBSCRIBE_SECRET present → the signed opt-out token can be minted. */
  unsubscribeConfigured: boolean;
  /** COMMS_POSTAL_ADDRESS present OR an operator Settings mailing address present. */
  postalAddressConfigured: boolean;
  /** RESEND_WEBHOOK_SECRET present → delivery webhooks can be verified. */
  webhookConfigured: boolean;
  /** COMMS_PROSPECT_DELIVERY_ENABLED === "1" → real prospects may receive (default OFF). */
  prospectDeliveryEnabled: boolean;
  /** COMMS_TEST_RECIPIENT present → a single whitelisted internal/QA address exists. */
  testRecipientConfigured: boolean;
  /** COMMS_AUTOSEND_ENABLED === "1" → the scheduler may auto-send (default OFF). */
  autosendEnabled: boolean;
  /** OUTREACH_SENDING_ENABLED === "1" → the operator send path is unlocked (default OFF). */
  sendingEnabled: boolean;
  /** The permanent-suppression module is wired at the send boundary. */
  suppressionActive: boolean;
  /** The nationwide global daily prospect send cap (a number, not a secret). */
  dailyCap: number;
}

/** Presence test that never returns the value — just whether a non-blank one is set. */
const present = (v: string | undefined): boolean => !!(v || "").trim();
/** A gate flag is ON only when it is exactly "1" (the codebase's convention). */
const flagOn = (v: string | undefined): boolean => (v || "").trim() === "1";

/**
 * Audit the send infrastructure from env + (optionally) a settings read. PURE with
 * respect to the world: it reads only configuration presence and returns booleans.
 * NEVER sends, NEVER charges, NEVER returns a secret / From / recipient value.
 *
 * `env` and `settings` are injectable so the audit is deterministic under test; both
 * default to the live process env and no settings (env-only) respectively.
 */
export async function auditSendInfrastructure(
  env: EnvLike = process.env,
  settings?: AuditSettingsInput | Settings | null,
): Promise<SendInfrastructureAudit> {
  // From identity: RESEND_FROM wins; otherwise the operator's Settings contact email
  // is the fallback From (per dispatch.ts senderFrom()). We report ONLY whether one
  // resolves — never which, never the address.
  const fromIdentityConfigured =
    present(env.RESEND_FROM) || present(settings?.contactEmail ?? undefined);

  // Postal address for the CAN-SPAM footer: COMMS_POSTAL_ADDRESS env OR the operator
  // Settings mailing address (commercial-message.ts postalAddress() fallback).
  const postalAddressConfigured =
    present(env.COMMS_POSTAL_ADDRESS) || present(settings?.businessAddress ?? undefined);

  return {
    provider: "resend",
    sendConfigured: present(env.RESEND_API_KEY),
    fromIdentityConfigured,
    replyToBehavior: "mirrors-from",
    unsubscribeConfigured: present(env.COMMS_UNSUBSCRIBE_SECRET),
    postalAddressConfigured,
    webhookConfigured: present(env.RESEND_WEBHOOK_SECRET),
    prospectDeliveryEnabled: flagOn(env.COMMS_PROSPECT_DELIVERY_ENABLED),
    testRecipientConfigured: present(env.COMMS_TEST_RECIPIENT),
    autosendEnabled: flagOn(env.COMMS_AUTOSEND_ENABLED),
    sendingEnabled: flagOn(env.OUTREACH_SENDING_ENABLED),
    // The suppression module is a hard dependency of the send boundary
    // (submitCompliantDispatch → isEmailSuppressed); its presence is a structural
    // fact of this build, not an env toggle.
    suppressionActive: true,
    dailyCap: GLOBAL_DAILY_CAP,
  };
}
