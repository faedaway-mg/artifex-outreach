// ─────────────────────────────────────────────────────────────────────────────
// Communication provider abstraction. The acquisition engine depends ONLY on
// these interfaces — never on Resend (or any provider) directly. A live provider
// (Resend) is dropped in later behind the same contract with zero engine changes.
//
// Nothing here sends: the default provider is a no-op that refuses to send while
// sending is disabled. Idempotency, scheduling, and rate-limit contracts are
// defined now so the live layer slots in cleanly.
// ─────────────────────────────────────────────────────────────────────────────
import { createResendProvider } from "./resend";

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  /** Optional HTML body. When present, sent alongside the plaintext part. */
  html?: string;
  headers?: Record<string, string>;
  idempotencyKey: string; // dedupes retries — a step never sends twice
}

export interface SendResult {
  sent: boolean;
  providerMessageId: string | null;
  reason?: string; // when not sent
  // Failure classification (Phase 9). retryable=true → transient (network, 429,
  // 5xx): the send should be re-queued with backoff. retryable=false → permanent
  // (invalid address, bad key, validation): log and stop. Unset when sent.
  retryable?: boolean;
  errorCode?: string; // e.g. "rate_limited", "auth", "network", "validation"
  statusCode?: number; // provider HTTP status, when applicable
}

export interface ProviderMeta {
  name: string;
  mode: "live" | "disabled";
  fromDomain: string | null; // verified sending domain, when known
  batchLimit: number; // max messages per sendBatch call
  configured: boolean; // credentials present
}

export interface HealthResult {
  ok: boolean;
  issues: string[];
  latencyMs?: number; // round-trip to a live provider ping, when performed
}

export interface EmailProvider {
  readonly name: string;
  readonly canSend: boolean;
  readonly meta: ProviderMeta;
  // send one message. `send` is the canonical name; `sendEmail` is a stable alias.
  send(msg: EmailMessage): Promise<SendResult>;
  sendEmail(msg: EmailMessage): Promise<SendResult>;
  // send many in one provider round-trip (chunked to meta.batchLimit). Results are
  // returned positionally, one per input message.
  sendBatch(msgs: EmailMessage[]): Promise<SendResult[]>;
  // static configuration validation (no network).
  verifyConfiguration(): Promise<{ ok: boolean; issues: string[] }>;
  // live reachability + credential check (network).
  healthCheck(): Promise<HealthResult>;
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
const DISABLED_REASON = "Email sending is disabled (no provider configured).";
export const disabledEmailProvider: EmailProvider = {
  name: "disabled",
  canSend: false,
  meta: { name: "disabled", mode: "disabled", fromDomain: null, batchLimit: 1, configured: false },
  async send(): Promise<SendResult> {
    return { sent: false, providerMessageId: null, reason: DISABLED_REASON, retryable: false, errorCode: "disabled" };
  },
  async sendEmail(): Promise<SendResult> {
    return { sent: false, providerMessageId: null, reason: DISABLED_REASON, retryable: false, errorCode: "disabled" };
  },
  async sendBatch(msgs: EmailMessage[]): Promise<SendResult[]> {
    return msgs.map(() => ({ sent: false, providerMessageId: null, reason: DISABLED_REASON, retryable: false, errorCode: "disabled" }));
  },
  async verifyConfiguration() {
    return { ok: false, issues: ["No email provider configured. Set up Resend + verified domain to enable sending."] };
  },
  async healthCheck() {
    return { ok: false, issues: ["Email sending disabled — no provider configured."] };
  },
};

// Resolver. Returns the live provider when one is wired + configured; otherwise
// the disabled no-op. Memoized so callers share a single instance (stable meta).
// The acquisition engine never calls this — only the communication layer does.
let cached: EmailProvider | null = null;
let cachedForKey: string | undefined;
export function getEmailProvider(): EmailProvider {
  const key = process.env.RESEND_API_KEY;
  if (cached && cachedForKey === key) return cached;
  cachedForKey = key;
  cached = key ? createResendProvider() : disabledEmailProvider;
  return cached;
}

// Test/hot-reload seam: drop the memoized provider so a changed env is re-read.
export function resetEmailProvider(): void {
  cached = null;
  cachedForKey = undefined;
}

export function commsStatus(): { provider: string; canSend: boolean; meta: ProviderMeta } {
  const p = getEmailProvider();
  return { provider: p.name, canSend: p.canSend, meta: p.meta };
}
