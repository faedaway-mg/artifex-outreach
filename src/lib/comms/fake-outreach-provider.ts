// ─────────────────────────────────────────────────────────────────────────────
// In-process FAKE outreach email provider — an intercepted test double for the no-send
// canonical-send rehearsal ONLY. It makes NO network call: it RECORDS the exact assembled
// message (recipient, subject, headers, bodies, attachment filename + SHA) and returns a
// deterministic synthetic provider message id, so the full canonical prepare → submit path
// can be exercised through the real transport core without ever touching Resend.
//
// SAFETY: getEmailProvider() returns this ONLY when COMMS_FAKE_PROVIDER is truthy AND the
// runtime is NOT production AND no real RESEND_API_KEY is present (all three required). It can
// never be selected on a production deployment and can never shadow a configured live provider.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { EmailProvider, EmailMessage, SendResult } from "./provider";

export interface RecordedOutreach {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  headers: Record<string, string>;
  textSha256: string;
  htmlSha256: string | null;
  attachmentFilename: string | null;
  attachmentSha256: string | null;
  idempotencyKey: string;
  providerMessageId: string;
}

/** In-memory capture of everything the fake "sent" — inspected by the rehearsal proofs. */
const recorded: RecordedOutreach[] = [];
export function recordedOutreach(): RecordedOutreach[] { return recorded.slice(); }
export function resetRecordedOutreach(): void { recorded.length = 0; }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Deterministic synthetic id derived from the idempotency identity (stable per message). */
function fakeMessageId(msg: EmailMessage): string {
  return `fake_msg_${createHash("sha256").update(`fake:${msg.idempotencyKey}:${msg.to}`).digest("hex").slice(0, 24)}`;
}

export const fakeOutreachProvider: EmailProvider = {
  name: "fake-outreach",
  canSend: true,
  meta: { name: "fake-outreach", mode: "disabled", fromDomain: null, batchLimit: 1, configured: true },
  async send(msg: EmailMessage): Promise<SendResult> {
    const providerMessageId = fakeMessageId(msg);
    const att = msg.attachments && msg.attachments[0] ? msg.attachments[0] : null;
    recorded.push({
      to: msg.to, from: msg.from, replyTo: msg.replyTo, subject: msg.subject,
      headers: { ...(msg.headers ?? {}) },
      textSha256: sha(msg.text), htmlSha256: msg.html != null ? sha(msg.html) : null,
      attachmentFilename: att?.filename ?? null,
      attachmentSha256: att ? createHash("sha256").update(Buffer.from(att.content, "base64")).digest("hex") : null,
      idempotencyKey: msg.idempotencyKey, providerMessageId,
    });
    return { sent: true, providerMessageId };
  },
  async sendEmail(msg: EmailMessage): Promise<SendResult> { return this.send(msg); },
  async sendBatch(msgs: EmailMessage[]): Promise<SendResult[]> { return Promise.all(msgs.map((m) => this.send(m))); },
  async verifyConfiguration() { return { ok: true, issues: [] }; },
  async healthCheck() { return { ok: true, issues: [] }; },
};

/** True only when the guarded intercepted double should be used (dev/rehearsal only; never prod). */
export function shouldUseFakeOutreachProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.COMMS_FAKE_PROVIDER ?? "").trim().toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  const notProd = (env.NODE_ENV ?? "development") !== "production";
  const noLiveKey = !env.RESEND_API_KEY;
  return on && notProd && noLiveKey;
}
