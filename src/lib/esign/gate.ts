// ─────────────────────────────────────────────────────────────────────────────
// Production send gate for the client-agreement system.
//
// AGREEMENT_SENDING_ENABLED must be explicitly "true" (or "1") to permit any live
// external action: sending an agreement to SignWell, or emailing a deposit request
// to a client. It is FALSE by default and false for any unrecognized value.
//
// When disabled, the system still fully functions internally — agreements can be
// generated, previewed, and downloaded, and the SignWell integration can run in
// test/mock mode — only real outbound sending is blocked. The operator UI reads
// this to explain WHY sending is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

export function agreementSendingEnabled(): boolean {
  const v = (process.env.AGREEMENT_SENDING_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Human-readable reason shown to the operator when sending is disabled. */
export function sendingDisabledReason(): string {
  return "Live agreement sending is disabled. Set AGREEMENT_SENDING_ENABLED=true (and complete legal review + sender-domain verification) to enable sending to clients.";
}

export class SendingDisabledError extends Error {
  constructor(message = sendingDisabledReason()) {
    super(message);
    this.name = "SendingDisabledError";
  }
}

/** Throw unless production sending is explicitly enabled. */
export function assertSendingEnabled(): void {
  if (!agreementSendingEnabled()) throw new SendingDisabledError();
}
