// ─────────────────────────────────────────────────────────────────────────────
// Communication provider abstraction. The acquisition engine depends ONLY on
// these interfaces — never on Resend (or any provider) directly. A live provider
// (Resend) is dropped in later behind the same contract with zero engine changes.
//
// Nothing here sends: the default provider is a no-op that refuses to send while
// sending is disabled. Idempotency, scheduling, and rate-limit contracts are
// defined now so the live layer slots in cleanly.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey: string; // dedupes retries — a step never sends twice
}

export interface SendResult {
  sent: boolean;
  providerMessageId: string | null;
  reason?: string; // when not sent
}

export interface EmailProvider {
  readonly name: string;
  readonly canSend: boolean;
  send(msg: EmailMessage): Promise<SendResult>;
  verifyConfiguration(): Promise<{ ok: boolean; issues: string[] }>;
}

// ── Inbound / event contracts ────────────────────────────────────────────────
export type DeliveryEventType = "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed";
export interface DeliveryEvent { type: DeliveryEventType; providerMessageId: string; at: string; detail?: string }
export interface InboundEmail { providerMessageId: string | null; from: string; subject: string; body: string; at: string }

export interface WebhookHandler { handle(payload: unknown, signature?: string): Promise<{ ok: boolean; kind: string }> }
export interface ReplyProcessor { classify(msg: InboundEmail): Promise<{ classification: string; confidence: number }> }
export interface EventProcessor { onDelivery(e: DeliveryEvent): Promise<void> }
export interface Scheduler { dueSteps(now: Date): Promise<string[]> } // step ids ready to send
export interface RateLimiter { allow(key: string): Promise<boolean> }
export interface IdempotencyStore { seen(key: string): Promise<boolean>; remember(key: string): Promise<void> }

// ── Default no-op provider (sending disabled) ────────────────────────────────
export const disabledEmailProvider: EmailProvider = {
  name: "disabled",
  canSend: false,
  async send(): Promise<SendResult> {
    return { sent: false, providerMessageId: null, reason: "Email sending is disabled (no provider configured)." };
  },
  async verifyConfiguration() {
    return { ok: false, issues: ["No email provider configured. Set up Resend + verified domain to enable sending."] };
  },
};

// Resolver. Returns the live provider when one is wired + configured; otherwise
// the disabled no-op. (Resend adapter is intentionally not implemented yet.)
export function getEmailProvider(): EmailProvider {
  // Future: if (process.env.RESEND_API_KEY) return resendProvider();
  return disabledEmailProvider;
}

export function commsStatus(): { provider: string; canSend: boolean } {
  const p = getEmailProvider();
  return { provider: p.name, canSend: p.canSend };
}
